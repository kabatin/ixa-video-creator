import { MediaAsset, MediaAssetId, VoiceJobId, WorkspaceId, newId, type Project } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { json, setupNarration, type Err } from './narration-fixture.js'

/**
 * 録音を取り込む・字の時刻を取る（ADR-0038）。どちらも「使う AI」の文字起こしで、worker が作る。
 * 頼む前に、音の長さから費用を見積もって予算を確かめる。
 */

const RECORDING_ID = newId(MediaAssetId)

const audio = (project: Project, patch: Partial<MediaAsset> = {}): MediaAsset =>
  MediaAsset.parse({
    id: RECORDING_ID,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'audio',
    storageKey: `media/${project.workspaceId}/x/original.wav`,
    mimeType: 'audio/wav',
    bytes: 100,
    checksumSha256: 'b'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'me' },
    probe: { durationSec: 12, width: null, height: null, fps: null, codec: 'pcm_s16le', hasAudio: true },
    proxyKey: null,
    thumbnailKey: null,
    posterKeys: [],
    lastFrameAssetId: null,
    createdAt: new Date(),
    deletedAt: null,
    ...patch,
  })

const importRecording = (setup: ReturnType<typeof setupNarration>, body: Record<string, unknown> = {}) =>
  setup.send('POST', `/projects/${setup.project.id}/narration/recordings`, { mediaAssetId: RECORDING_ID, ...body })

describe('録音を取り込む', () => {
  it('選んでいる文字起こしの AI でジョブを作る（置く位置・話す声も記す）', async () => {
    const setup = setupNarration({ assets: (project) => [audio(project)] })
    const voice = await setup.deps.voices.create({ projectId: setup.project.id, name: 'ナレーター', tool: 'stub', voiceName: 'stub' })

    const response = await importRecording(setup, { voiceProfileId: voice.id, placeAtSec: 4 })

    expect(response.status).toBe(202)
    const job = setup.deps.voiceJobs.snapshot()[0]
    expect(job).toMatchObject({ kind: 'transcribe', tool: 'stub', inputMediaAssetId: RECORDING_ID, voiceProfileId: voice.id, placeAtSec: 4 })
    expect(setup.enqueued).toEqual([job?.id])
  })

  it('音のファイルでない・別の場所の素材は 422、長さをまだ測っていない音は 409', async () => {
    const image = setupNarration({ assets: (project) => [audio(project, { kind: 'image', mimeType: 'image/png' })] })
    const elsewhere = setupNarration({ assets: (project) => [audio(project, { workspaceId: newId(WorkspaceId) })] })
    const unprobed = setupNarration({ assets: (project) => [audio(project, { probe: null })] })

    expect((await importRecording(image)).status).toBe(422)
    expect((await importRecording(elsewhere)).status).toBe(422)
    const pending = await importRecording(unprobed)
    expect(pending.status).toBe(409)
    expect((await json<Err>(pending)).error).toMatch(/長さ/)
  })

  it('選んでいる文字起こしの AI の口が無ければ 409（理由に「使う AI」）', async () => {
    const setup = setupNarration({ assets: (project) => [audio(project)], transcribeTool: 'whisper_cpp' })

    const response = await importRecording(setup)

    expect(response.status).toBe(409)
    expect((await json<Err>(response)).error).toMatch(/使う AI/)
  })

  it('音の長さからの見積もりが予算を超えるなら頼まない（422）', async () => {
    const setup = setupNarration({ assets: (project) => [audio(project)], costPerTranscribe: 2, budgetUsd: 1 })

    expect((await importRecording(setup)).status).toBe(422)
    expect(setup.deps.voiceJobs.snapshot()).toHaveLength(0)
  })
})

describe('字の時刻を取る', () => {
  it('Take の音を、選んでいる文字起こしの AI で聞き取るジョブを作る', async () => {
    const setup = setupNarration({ assets: (project) => [audio(project)] })
    await setup.send('POST', `/projects/${setup.project.id}/narration/script`, { text: '進め' })
    const [line] = setup.deps.lines.snapshot()
    if (line === undefined) throw new Error('行がありません')
    const take = await setup.deps.takes.create({
      lineId: line.id,
      source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'macos_say', model: null, voiceName: 'Kyoko' },
      mediaAssetId: RECORDING_ID,
      inSec: 0,
      outSec: 1.2,
      spokenText: 'すすめ',
      displayText: '進め',
      specHash: 'abc',
      charTimes: null,
      loudnessLufs: null,
      peaks: null,
      costUsd: 0,
    })

    const response = await setup.send('POST', `/narration-takes/${take.id}/char-timing`)

    expect(response.status).toBe(202)
    expect(setup.deps.voiceJobs.snapshot()[0]).toMatchObject({ kind: 'char_timing', takeId: take.id, lineId: line.id, inputMediaAssetId: RECORDING_ID })
    expect((await setup.send('POST', `/narration-takes/${newId(MediaAssetId)}/char-timing`)).status).toBe(404)
  })
})
