import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MediaAssetId, VoiceJobId, newId, type CharTime, type MediaAsset } from '@ixa/domain'
import {
  createInMemoryAudioSettingsRepository,
  createInMemoryNarrationLineRepository,
  createInMemoryNarrationTakeRepository,
  createInMemoryTextStyleRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryVoiceJobRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import type { Transcriber, TranscribeResult } from '@ixa/provider-core'
import { createStubVoice } from '@ixa/provider-voice'
import { createMemoryStorage, mediaKey } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aProject,
  createRecordingEvents,
  createRecordingMediaQueue,
  inMemoryMediaAssets,
  inMemoryProjects,
  silentLogger,
} from '../../generation/__tests__/doubles.js'
import { processVoiceJob, type VoiceProcessorDeps } from '../processor.js'

/**
 * 録音を取り込む（ADR-0038）。軽いノイズ除去と大きさを揃えた音を素材にし、文字起こしして行に分ける。
 * 各行の Take は同じ音の区間を指す。字の時刻が無い声には、後から文字起こしで字の時刻を付ける。
 */

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-voice-transcribe-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = aProject()

const said = (text: string, from: number, step = 0.1): readonly CharTime[] =>
  [...text].map((char, i) => ({ char, startSec: from + i * step, endSec: from + (i + 1) * step }))

const transcriberReturning = (result: Partial<TranscribeResult>, seen: string[] = []): Transcriber => ({
  tool: 'stub',
  transcribe: (request) => {
    seen.push(request.audioPath)
    return Promise.resolve({ text: '', chars: null, segments: [], costUsd: 0.05, record: { tool: 'stub' }, ...result })
  },
})

const setup = async (transcriber: Transcriber | null) => {
  const mediaAssets = inMemoryMediaAssets()
  const storage = createMemoryStorage()
  const recordingId = newId(MediaAssetId)
  const storageKey = mediaKey(project.workspaceId, recordingId, 'wav')
  await storage.put(storageKey, Buffer.from('recording-bytes'), { contentType: 'audio/wav' })
  const recording: MediaAsset = await mediaAssets.create({
    id: recordingId,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'audio',
    storageKey,
    mimeType: 'audio/wav',
    bytes: 15,
    checksumSha256: 'a'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'me' },
  })
  const normalized: { denoise: boolean }[] = []
  const deps = {
    voiceJobs: createInMemoryVoiceJobRepository(),
    lines: createInMemoryNarrationLineRepository(),
    takes: createInMemoryNarrationTakeRepository(),
    audioSettings: createInMemoryAudioSettingsRepository(),
    voices: createInMemoryVoiceProfileRepository(),
    textStyles: createInMemoryTextStyleRepository(),
    timelineClips: createInMemoryTimelineClipRepository(),
    projects: inMemoryProjects([project]),
    mediaAssets,
    storage,
    voiceAdapter: () => createStubVoice(),
    transcriber: () => transcriber,
    audio: {
      normalize: async (input: string, output: string, options: { readonly denoise: boolean }) => {
        normalized.push(options)
        await copyFile(input, output)
        return { integratedLufs: -16.5, truePeakDb: -2 }
      },
      durationSec: () => Promise.resolve(10),
      peaks: () => Promise.resolve(Array.from({ length: 100 }, (_, i) => i / 100)),
    },
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    workDir: dir,
    logger: silentLogger,
  } satisfies VoiceProcessorDeps
  return { deps, recording, normalized }
}

describe('録音を取り込む（transcribe）', () => {
  it('ノイズ除去して素材にし、文字起こしを行に分けて、置く位置からの秒で並べる。各行の Take は同じ音の区間を指す', async () => {
    const seen: string[] = []
    const { deps, recording, normalized } = await setup(
      transcriberReturning({ text: '進め。勝負だ', chars: [...said('進め。', 1), ...said('勝負だ', 3)] }, seen),
    )
    const job = await deps.voiceJobs.create({ kind: 'transcribe', projectId: project.id, inputMediaAssetId: recording.id, voiceProfileId: null, placeAtSec: 2, tool: 'stub', model: null })

    expect((await processVoiceJob(deps, { voiceJobId: job.id })).state).toBe('succeeded')

    expect(normalized).toEqual([{ denoise: true }])
    const cleaned = deps.mediaAssets.snapshot().find((asset) => asset.id !== recording.id)
    expect(cleaned?.origin).toEqual({ type: 'derived', sourceAssetId: recording.id, operation: 'voice_cleanup' })
    expect(seen).toHaveLength(1)

    const lines = deps.lines.snapshot()
    expect(lines.map((line) => [line.text, line.startSec])).toEqual([
      ['進め。', 3],
      ['勝負だ', 5],
    ])
    const takes = deps.takes.snapshot()
    expect(takes.map((take) => [take.mediaAssetId, take.inSec, Math.round(take.outSec * 10) / 10])).toEqual([
      [cleaned?.id, 1, 1.3],
      [cleaned?.id, 3, 3.3],
    ])
    expect(takes[0]?.source).toEqual({ type: 'recording', voiceJobId: job.id })
    expect(takes[0]?.charTimes?.[0]).toEqual({ char: '進', startSec: 0, endSec: expect.closeTo(0.1, 5) as unknown })
    expect(lines.map((line) => line.selectedTakeId)).toEqual(takes.map((take) => take.id))
    expect(deps.voiceJobs.snapshot()[0]).toMatchObject({ status: 'succeeded', costUsd: 0.05 })
    // 取り込んだ行には、その場でテロップが付く。
    expect(deps.timelineClips.snapshot().map((clip) => clip.startSec)).toEqual([3, 5])
  })

  it('区間しか返さない文字起こしは、区間の中を拍で字に割り振る（字の時刻を付ける）', async () => {
    const { deps, recording } = await setup(
      transcriberReturning({ text: 'はい', segments: [{ text: 'はい', startSec: 0.5, endSec: 1.5 }] }),
    )
    const job = await deps.voiceJobs.create({ kind: 'transcribe', projectId: project.id, inputMediaAssetId: recording.id, voiceProfileId: null, placeAtSec: 0, tool: 'stub', model: null })

    await processVoiceJob(deps, { voiceJobId: job.id })

    expect(deps.lines.snapshot().map((line) => [line.text, line.startSec])).toEqual([['はい', 0.5]])
    expect(deps.takes.snapshot()[0]?.charTimes?.map((t) => t.char)).toEqual(['は', 'い'])
  })

  it('何も聞き取れなければ、理由を付けて失敗にする（行を作らない）', async () => {
    const { deps, recording } = await setup(transcriberReturning({ text: '' }))
    const job = await deps.voiceJobs.create({ kind: 'transcribe', projectId: project.id, inputMediaAssetId: recording.id, voiceProfileId: null, placeAtSec: 0, tool: 'stub', model: null })

    expect((await processVoiceJob(deps, { voiceJobId: job.id })).state).toBe('failed')
    expect(deps.voiceJobs.snapshot()[0]?.error?.code).toBe('no_speech')
    expect(deps.lines.snapshot()).toHaveLength(0)
  })

  it('文字起こしの AI の口が無ければ、理由を付けて失敗にする', async () => {
    const { deps, recording } = await setup(null)
    const job = await deps.voiceJobs.create({ kind: 'transcribe', projectId: project.id, inputMediaAssetId: recording.id, voiceProfileId: null, placeAtSec: 0, tool: 'whisper_cpp', model: null })

    await processVoiceJob(deps, { voiceJobId: job.id })

    expect(deps.voiceJobs.snapshot()[0]?.error).toMatchObject({ code: 'provider_unavailable', retryable: false })
  })
})

describe('字の時刻を取る（char_timing）', () => {
  it('Take の音を文字起こしして、表示の字に時刻を付ける（音・読みは変えない）', async () => {
    const { deps, recording } = await setup(transcriberReturning({ text: '進め', chars: said('進め', 0.2) }))
    const [line] = await deps.lines.createMany([{ projectId: project.id, order: 0, text: '進め', startSec: 4 }])
    if (line === undefined) throw new Error('行がありません')
    const settings = await deps.audioSettings.get(project.id)
    await deps.audioSettings.save({ ...settings, telopHighlight: { enabled: true, color: '#ff0000' } })
    const take = await deps.takes.create({
      lineId: line.id,
      source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'macos_say', model: null, voiceName: 'Kyoko' },
      mediaAssetId: recording.id,
      inSec: 0,
      outSec: 1,
      spokenText: 'すすめ',
      displayText: '進め',
      specHash: 'abc',
      charTimes: null,
      loudnessLufs: -16,
      peaks: null,
      costUsd: 0,
    })
    await deps.lines.update(line.id, { selectedTakeId: take.id })
    const job = await deps.voiceJobs.create({ kind: 'char_timing', projectId: project.id, lineId: line.id, takeId: take.id, inputMediaAssetId: recording.id, tool: 'stub', model: null })

    expect((await processVoiceJob(deps, { voiceJobId: job.id })).state).toBe('succeeded')

    const updated = deps.takes.snapshot()[0]
    expect(updated?.charTimes?.map((t) => [t.char, Math.round(t.startSec * 10) / 10])).toEqual([
      ['進', 0.2],
      ['め', 0.3],
    ])
    expect(updated?.mediaAssetId).toBe(recording.id)
    // 字の時刻が付いたので、話している字の強調がテロップに付く。
    expect(deps.timelineClips.snapshot()[0]?.content).toMatchObject({ params: { text: '進め', highlight: { color: '#ff0000' } } })
  })
})
