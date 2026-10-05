import {
  MediaAssetId,
  VoiceJobId,
  lineReading,
  newId,
  voiceSpecHash,
  voiceSpecOf,
  type NarrationLine,
  type VoiceProfile,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { json, setupNarration, type Err, type Ok } from './narration-fixture.js'

/**
 * 行を声にする（ADR-0038）。ジョブを作って worker の `voice` キューへ入れる（作るのは worker）。
 * - 同じ読み・声・設定の Take があれば作り直さず、それを選ぶ（Gemini の無料枠 1 日 100 回の対策にもなる）
 * - 頼む前に予算を確かめる（画像のジョブはしていない。声は真似しない）
 */

type Setup = ReturnType<typeof setupNarration>
type SpeakResult = { jobId: string | null; reusedTakeId: string | null }
type BulkResult = { jobIds: string[]; reusedTakeIds: string[]; skipped: { noVoice: number; active: number; upToDate: number } }

const withVoice = async (setup: Setup, patch: Partial<VoiceProfile> = {}) =>
  setup.deps.voices.create({ projectId: setup.project.id, name: 'ナレーター', tool: 'stub', voiceName: 'stub', ...patch })

const pasteLines = async (setup: Setup, text: string, voiceProfileId: string | null) => {
  await setup.send('POST', `/projects/${setup.project.id}/narration/script`, { text, voiceProfileId })
  return setup.deps.lines.snapshot()
}

const takeMatching = async (setup: Setup, line: NarrationLine, voice: VoiceProfile) =>
  setup.deps.takes.create({
    lineId: line.id,
    source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: voice.tool, model: voice.model, voiceName: voice.voiceName },
    mediaAssetId: newId(MediaAssetId),
    inSec: 0,
    outSec: 1,
    spokenText: line.text,
    displayText: line.text,
    specHash: await voiceSpecHash(voiceSpecOf(voice, line, lineReading(line, []).reading)),
    charTimes: null,
    loudnessLufs: null,
    peaks: null,
    costUsd: 0,
  })

describe('1 行を声にする', () => {
  it('ジョブを作ってキューへ入れる（読みは辞書から。指定を記す）。出来事を流す', async () => {
    const setup = setupNarration()
    const voice = await withVoice(setup)
    await setup.send('PUT', `/projects/${setup.project.id}/audio-settings`, {
      readingDictionary: [{ written: '戦子', reading: 'せんこ' }],
      ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
    })
    const [line] = await pasteLines(setup, '進め、戦子', voice.id)

    const response = await setup.send('POST', `/narration-lines/${String(line?.id)}/speak`)

    expect(response.status).toBe(202)
    const { jobId } = (await json<Ok<SpeakResult>>(response)).data
    const job = setup.deps.voiceJobs.snapshot().find((j) => j.id === jobId)
    expect(job).toMatchObject({ kind: 'speak', status: 'queued', tool: 'stub', lineId: line?.id })
    expect(job?.spec?.reading).toBe('進め、せんこ')
    expect(setup.enqueued).toEqual([jobId])
    expect(setup.events.published().map((e) => e.type)).toContain('voice_job.status')
  })

  it('声が決まっていなければ 422、その声の AI の口が無ければ 409', async () => {
    const setup = setupNarration()
    const [line] = await pasteLines(setup, '進め', null)
    expect((await setup.send('POST', `/narration-lines/${String(line?.id)}/speak`)).status).toBe(422)

    const gemini = await withVoice(setup, { name: 'Gemini', tool: 'gemini_api', voiceName: 'Kore' })
    await setup.send('PATCH', `/narration-lines/${String(line?.id)}`, { voiceProfileId: gemini.id })
    const unavailable = await setup.send('POST', `/narration-lines/${String(line?.id)}/speak`)
    expect(unavailable.status).toBe(409)
    expect((await json<Err>(unavailable)).error).toMatch(/使う AI/)
  })

  it('同じ読み・声・設定の Take があれば作り直さず、それを選ぶ（ジョブを作らない）', async () => {
    const setup = setupNarration()
    const voice = await withVoice(setup)
    const [line] = await pasteLines(setup, '進め', voice.id)
    if (line === undefined) throw new Error('行がありません')
    const take = await takeMatching(setup, line, voice)

    const response = await setup.send('POST', `/narration-lines/${line.id}/speak`)

    expect(response.status).toBe(200)
    expect((await json<Ok<SpeakResult>>(response)).data).toEqual({ jobId: null, reusedTakeId: take.id })
    expect(setup.deps.lines.snapshot()[0]?.selectedTakeId).toBe(take.id)
    expect(setup.deps.voiceJobs.snapshot()).toHaveLength(0)
  })

  it('作っている途中なら 409（重ねて頼まない）', async () => {
    const setup = setupNarration()
    const voice = await withVoice(setup)
    const [line] = await pasteLines(setup, '進め', voice.id)
    await setup.send('POST', `/narration-lines/${String(line?.id)}/speak`)

    expect((await setup.send('POST', `/narration-lines/${String(line?.id)}/speak`)).status).toBe(409)
  })

  it('予算を超える見積もりなら頼まない（422・理由つき）', async () => {
    const setup = setupNarration({ costPerSpeak: 2, budgetUsd: 1 })
    const voice = await withVoice(setup)
    const [line] = await pasteLines(setup, '進め', voice.id)

    const response = await setup.send('POST', `/narration-lines/${String(line?.id)}/speak`)

    expect(response.status).toBe(422)
    expect((await json<Err>(response)).fields?.cost).toBeDefined()
    expect(setup.deps.voiceJobs.snapshot()).toHaveLength(0)
  })

  it('キューへ入れ損ねたら、ジョブを失敗にしてから 500（「作っています」のまま残さない）', async () => {
    const setup = setupNarration({ enqueueFails: true })
    const voice = await withVoice(setup)
    const [line] = await pasteLines(setup, '進め', voice.id)

    const response = await setup.send('POST', `/narration-lines/${String(line?.id)}/speak`)

    expect(response.status).toBe(500)
    expect(setup.deps.voiceJobs.snapshot()[0]?.status).toBe('failed')
  })
})

describe('まとめて声にする', () => {
  it('作り直しが要る行だけ頼む。声が未定・作っている途中・今の Take が新しい行は数えて飛ばす', async () => {
    const setup = setupNarration()
    const voice = await withVoice(setup)
    const lines = await pasteLines(setup, 'いち\nに\nさん', voice.id)
    const [first, second, third] = lines
    if (first === undefined || second === undefined || third === undefined) throw new Error('行がありません')
    await setup.send('PATCH', `/narration-lines/${third.id}`, { voiceProfileId: null })
    const take = await takeMatching(setup, second, voice)
    await setup.send('PATCH', `/narration-lines/${second.id}`, { selectedTakeId: take.id })

    const response = await setup.send('POST', `/projects/${setup.project.id}/narration/speak`, {})

    expect(response.status).toBe(202)
    const result = (await json<Ok<BulkResult>>(response)).data
    expect(result.jobIds).toHaveLength(1)
    expect(result.skipped).toEqual({ noVoice: 1, active: 0, upToDate: 1 })
    expect(setup.deps.voiceJobs.snapshot()[0]?.lineId).toBe(first.id)
  })

  it('全部の見積もりが予算を超えるなら、1 件も頼まない', async () => {
    const setup = setupNarration({ costPerSpeak: 0.6, budgetUsd: 1 })
    const voice = await withVoice(setup)
    await pasteLines(setup, 'いち\nに', voice.id)

    expect((await setup.send('POST', `/projects/${setup.project.id}/narration/speak`, {})).status).toBe(422)
    expect(setup.deps.voiceJobs.snapshot()).toHaveLength(0)
  })
})

describe('試しに読む・止める・ジョブを見る', () => {
  it('声を試しに読む（好きな一文。Take にはしない）', async () => {
    const setup = setupNarration()
    const voice = await withVoice(setup)

    const response = await setup.send('POST', `/voices/${voice.id}/preview`, { text: '進め、戦子ちゃん。' })

    expect(response.status).toBe(202)
    const { jobId } = (await json<Ok<{ jobId: string }>>(response)).data
    const job = (await json<Ok<{ kind: string; status: string; resultMediaAssetId: string | null }>>(await setup.send('GET', `/voice-jobs/${jobId}`))).data
    expect(job).toMatchObject({ kind: 'preview', status: 'queued', resultMediaAssetId: null })
  })

  it('作品の声のジョブを止める（行を指定すればその行だけ）', async () => {
    const setup = setupNarration()
    const voice = await withVoice(setup)
    const [first, second] = await pasteLines(setup, 'いち\nに', voice.id)
    await setup.send('POST', `/projects/${setup.project.id}/narration/speak`, {})

    const one = await setup.send('POST', `/projects/${setup.project.id}/voice-jobs/cancel`, { lineIds: [first?.id] })
    const rest = await setup.send('POST', `/projects/${setup.project.id}/voice-jobs/cancel`, {})

    expect((await json<Ok<{ cancelledJobIds: string[] }>>(one)).data.cancelledJobIds).toHaveLength(1)
    expect((await json<Ok<{ cancelledJobIds: string[] }>>(rest)).data.cancelledJobIds).toHaveLength(1)
    expect(setup.deps.voiceJobs.snapshot().every((job) => job.status === 'cancelled')).toBe(true)
    expect(setup.deps.voiceJobs.snapshot().map((job) => job.lineId).sort()).toEqual([first?.id, second?.id].sort())
  })
})
