import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lineReading, narrationLineOf, voiceSpecHash, voiceSpecOf, type VoiceProfile } from '@ixa/domain'
import {
  createInMemoryAudioSettingsRepository,
  createInMemoryNarrationLineRepository,
  createInMemoryNarrationTakeRepository,
  createInMemoryTextStyleRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryVoiceJobRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import { VoiceProviderError, type VoiceAdapter } from '@ixa/provider-core'
import { createStubVoice } from '@ixa/provider-voice'
import { createMemoryStorage } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aProject,
  createRecordingEvents,
  createRecordingMediaQueue,
  inMemoryMediaAssets,
  inMemoryProjects,
  silentLogger,
} from '../../generation/__tests__/doubles.js'
import { failInterruptedVoiceJob } from '../interrupted.js'
import { processVoiceJob, type VoiceProcessorDeps } from '../processor.js'

/**
 * 行を声にする（ADR-0038）。AI に読ませ → 大きさを整え → 長さと波形を測り → 素材にして Take を足し、行に選ぶ。
 * 字の時刻は読みに付くので、表示へ写し戻す。止めたジョブは取り込まない。
 */

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-voice-processor-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = aProject()
const voice: VoiceProfile = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' as VoiceProfile['id'],
  projectId: project.id,
  name: 'ナレーター',
  tool: 'stub',
  model: null,
  voiceName: 'stub',
  styleNote: '',
  speed: 1,
  volume: 1,
  language: 'ja',
  tuning: {},
  textStyleId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/** 音を整える代わり（ffmpeg を使わない）。写して、決まった大きさ・長さ・波形を返す。 */
const fakeAudio = {
  normalize: async (input: string, output: string) => {
    await copyFile(input, output)
    return { integratedLufs: -16, truePeakDb: -2 }
  },
  durationSec: () => Promise.resolve(1.2),
  peaks: () => Promise.resolve([0.2, 0.8]),
}

const setup = async (
  options: { readonly adapter?: VoiceAdapter | null; readonly dictionary?: boolean; readonly startSec?: number | null } = {},
) => {
  const lines = createInMemoryNarrationLineRepository()
  const audioSettings = createInMemoryAudioSettingsRepository()
  if (options.dictionary !== false) {
    await audioSettings.save({
      projectId: project.id,
      readingDictionary: [{ written: '戦子', reading: 'せんこ' }],
      ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
      telopHighlight: { enabled: false, color: '#ffd400' },
    })
  }
  const [line] = await lines.createMany([
    { projectId: project.id, order: 0, text: '進め戦子', voiceProfileId: voice.id, startSec: options.startSec ?? null },
  ])
  if (line === undefined) throw new Error('行がありません')
  const voiceJobs = createInMemoryVoiceJobRepository()
  const reading = lineReading(line, (await audioSettings.get(project.id)).readingDictionary).reading
  const spec = voiceSpecOf(voice, line, reading)
  const job = await voiceJobs.create({ kind: 'speak', projectId: project.id, lineId: line.id, voiceProfileId: voice.id, spec, tool: 'stub', model: null })
  const deps = {
    voiceJobs,
    lines,
    takes: createInMemoryNarrationTakeRepository(),
    audioSettings,
    voices: createInMemoryVoiceProfileRepository(),
    textStyles: createInMemoryTextStyleRepository(),
    timelineClips: createInMemoryTimelineClipRepository(),
    projects: inMemoryProjects([project]),
    mediaAssets: inMemoryMediaAssets(),
    storage: createMemoryStorage(),
    voiceAdapter: () => (options.adapter === undefined ? createStubVoice() : options.adapter),
    transcriber: () => null,
    audio: fakeAudio,
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    workDir: dir,
    logger: silentLogger,
  } satisfies VoiceProcessorDeps
  return { deps, job, line, spec }
}

describe('processVoiceJob（読む）', () => {
  it('Take を足して行に選ぶ（長さ・大きさ・波形・指定のハッシュ・字の時刻を表示に写す）。素材を作り、出来事を流す', async () => {
    const { deps, job, line, spec } = await setup()

    expect((await processVoiceJob(deps, { voiceJobId: job.id })).state).toBe('succeeded')

    const [take] = deps.takes.snapshot()
    expect(take).toMatchObject({
      lineId: line.id,
      index: 1,
      inSec: 0,
      outSec: 1.2,
      spokenText: '進めせんこ',
      displayText: '進め戦子',
      specHash: await voiceSpecHash(spec),
      loudnessLufs: -16,
      peaks: [0.2, 0.8],
      costUsd: 0,
    })
    // お試しの声は読み（5 字）に時刻を付ける。表示（4 字）へ写し戻す。
    expect(take?.charTimes?.map((t) => t.char)).toEqual(['進', 'め', '戦', '子'])
    expect(deps.lines.snapshot()[0]?.selectedTakeId).toBe(take?.id)
    expect(deps.mediaAssets.snapshot()[0]).toMatchObject({ kind: 'audio', origin: { type: 'generated_voice', voiceJobId: job.id } })
    expect(deps.voiceJobs.snapshot()[0]).toMatchObject({ status: 'succeeded', costUsd: 0 })
    expect(deps.events.published().map((e) => (e.type === 'voice_job.status' ? e.status : e.type))).toEqual(['running', 'succeeded'])
  })

  it('置いてある行なら、声ができたらテロップを作る（出来事を流す前に。画面が読み直したときに揃っている）', async () => {
    const { deps, job, line } = await setup({ startSec: 3 })
    const telopsWhenPublished: number[] = []
    const events = {
      ...deps.events,
      publish: async (event: Parameters<typeof deps.events.publish>[0]) => {
        telopsWhenPublished.push(deps.timelineClips.snapshot().length)
        await deps.events.publish(event)
      },
    }

    await processVoiceJob({ ...deps, events }, { voiceJobId: job.id })

    const telops = deps.timelineClips.snapshot()
    expect(telops.map((clip) => [clip.startSec, clip.content.type === 'text' ? narrationLineOf(clip.content.params) : null])).toEqual([[3, line.id]])
    expect(telopsWhenPublished.at(-1)).toBe(1)
  })

  it('テロップを作れなくても、声は取り込んで成功にする（理由はログに残す。次に行を直すと作り直す）', async () => {
    const { deps, job } = await setup({ startSec: 3 })
    const broken = { ...deps.timelineClips, replace: () => Promise.reject(new Error('DB に繋がりません')) }

    expect((await processVoiceJob({ ...deps, timelineClips: broken }, { voiceJobId: job.id })).state).toBe('succeeded')
    expect(deps.takes.snapshot()).toHaveLength(1)
  })

  it('頼んだ後に読みが変わっていたら、字の時刻は付けない（ずれた時刻で字幕を出さない）', async () => {
    const { deps, job } = await setup()
    await deps.audioSettings.save({
      projectId: project.id,
      readingDictionary: [{ written: '戦子', reading: 'いくさこ' }],
      ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
      telopHighlight: { enabled: false, color: '#ffd400' },
    })

    await processVoiceJob(deps, { voiceJobId: job.id })

    expect(deps.takes.snapshot()[0]?.charTimes).toBeNull()
  })

  it('同じ音が 2 度できても、素材は使い回す（同じ中身のファイルを 2 つ作れない）', async () => {
    const { deps, job, line, spec } = await setup()
    await processVoiceJob(deps, { voiceJobId: job.id })
    const second = await deps.voiceJobs.create({ kind: 'speak', projectId: project.id, lineId: line.id, voiceProfileId: voice.id, spec, tool: 'stub', model: null })

    expect((await processVoiceJob(deps, { voiceJobId: second.id })).state).toBe('succeeded')

    expect(deps.mediaAssets.snapshot()).toHaveLength(1)
    expect(deps.takes.snapshot().map((take) => take.index)).toEqual([1, 2])
  })

  it('始める前に止められていたら、何もしない', async () => {
    const { deps, job } = await setup()
    await deps.voiceJobs.cancelActive({ projectId: project.id })

    expect((await processVoiceJob(deps, { voiceJobId: job.id })).state).toBe('skipped')
    expect(deps.takes.snapshot()).toHaveLength(0)
  })

  it('読んでいる間に止められたら、取り込まない（止めたのに声が変わらないように）', async () => {
    const stub = createStubVoice()
    const holder: { deps?: VoiceProcessorDeps } = {}
    const cancelling: VoiceAdapter = {
      ...stub,
      speak: async (request) => {
        await holder.deps?.voiceJobs.cancelActive({ projectId: project.id })
        return stub.speak(request)
      },
    }
    const { deps, job } = await setup({ adapter: cancelling })
    holder.deps = deps

    expect((await processVoiceJob(deps, { voiceJobId: job.id })).state).toBe('skipped')
    expect(deps.takes.snapshot()).toHaveLength(0)
    expect(deps.voiceJobs.snapshot()[0]?.status).toBe('cancelled')
  })

  it('この環境に口の無い AI なら、理由を付けて失敗にする', async () => {
    const { deps, job } = await setup({ adapter: null })

    expect((await processVoiceJob(deps, { voiceJobId: job.id })).state).toBe('failed')
    expect(deps.voiceJobs.snapshot()[0]?.error).toMatchObject({ code: 'provider_unavailable', retryable: false })
  })

  it('AI の失敗（回数の上限など）は、その文と、やり直せるかをそのまま残す', async () => {
    const limited: VoiceAdapter = {
      ...createStubVoice(),
      speak: () => Promise.reject(new VoiceProviderError('rate_limited', 'Gemini の回数の上限に達しました', true)),
    }
    const { deps, job } = await setup({ adapter: limited })

    await processVoiceJob(deps, { voiceJobId: job.id })

    expect(deps.voiceJobs.snapshot()[0]?.error).toEqual({ code: 'rate_limited', message: 'Gemini の回数の上限に達しました', retryable: true })
    expect(deps.events.published().at(-1)).toMatchObject({ type: 'voice_job.status', status: 'failed' })
  })
})

describe('processVoiceJob（試しに読む）', () => {
  it('音だけ素材にしてジョブに残す（Take にはしない）', async () => {
    const { deps, spec } = await setup()
    const preview = await deps.voiceJobs.create({ kind: 'preview', projectId: project.id, voiceProfileId: voice.id, spec, tool: 'stub', model: null })

    expect((await processVoiceJob(deps, { voiceJobId: preview.id })).state).toBe('succeeded')

    const done = deps.voiceJobs.snapshot().find((job) => job.id === preview.id)
    expect(done?.resultMediaAssetId).toBe(deps.mediaAssets.snapshot()[0]?.id)
    expect(deps.takes.snapshot()).toHaveLength(0)
  })
})

describe('failInterruptedVoiceJob', () => {
  it('キューに打ち切られたジョブを失敗にする（「作っています」のまま残さない）', async () => {
    const { deps, job } = await setup()
    await deps.voiceJobs.markRunning(job.id)

    await failInterruptedVoiceJob(deps, { voiceJobId: job.id }, 'stalled')

    expect(deps.voiceJobs.snapshot()[0]).toMatchObject({ status: 'failed', error: { code: 'interrupted' } })
  })
})
