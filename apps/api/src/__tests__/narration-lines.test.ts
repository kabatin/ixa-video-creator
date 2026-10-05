import { MediaAssetId, VoiceJobId, lineReading, newId, voiceSpecHash, voiceSpecOf, type NarrationLineId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { json, setupNarration, type Err, type Ok } from './narration-fixture.js'

/**
 * ナレーションの原稿（ADR-0038）。貼り付けた原稿を行に分け、行ごとに表示・読み・声・演出・位置を持つ。
 * 一覧は、読み（辞書から）・話す長さの見積もり・声の Take・作り直しが要るかを添えて返す。
 */

type Line = {
  id: string
  order: number
  text: string
  reading: string
  readingIsManual: boolean
  voiceProfileId: string | null
  startSec: number | null
  estimatedSec: number
  durationSec: number | null
  stale: boolean
  takes: { id: string; index: number; durationSec: number }[]
}
type Overview = { lines: Line[]; totalEstimatedSec: number; endSec: number }

const overview = async (setup: ReturnType<typeof setupNarration>) =>
  (await json<Ok<Overview>>(await setup.send('GET', `/projects/${setup.project.id}/narration`))).data

const paste = (setup: ReturnType<typeof setupNarration>, text: string, extra: Record<string, unknown> = {}) =>
  setup.send('POST', `/projects/${setup.project.id}/narration/script`, { text, ...extra })

describe('原稿を貼り付ける', () => {
  it('1 行 = 1 フレーズに分ける（前後の空白と空行は落とす）。前からある行の後ろに足す', async () => {
    const setup = setupNarration()
    await paste(setup, 'はじまり。')

    const response = await paste(setup, ' 勝負の時が来た。\n\n  進め、戦子ちゃん！ \n')

    expect(response.status).toBe(201)
    expect((await overview(setup)).lines.map((line) => [line.order, line.text])).toEqual([
      [0, 'はじまり。'],
      [1, '勝負の時が来た。'],
      [2, '進め、戦子ちゃん！'],
    ])
  })

  it('長すぎる行は、何行目かを言って 422（1 行も作らない）', async () => {
    const setup = setupNarration()

    const response = await paste(setup, `短い行\n${'あ'.repeat(201)}`)

    expect(response.status).toBe(422)
    expect((await json<Err>(response)).fields?.text?.[0]).toMatch(/2 行目/)
    expect(setup.deps.lines.snapshot()).toHaveLength(0)
  })

  it('別の作品の声は付けられない（422）', async () => {
    const setup = setupNarration()
    const voice = await setup.deps.voices.create({ projectId: setup.other.id, name: '他', tool: 'stub', voiceName: 'stub' })

    expect((await paste(setup, '進め。', { voiceProfileId: voice.id })).status).toBe(422)
  })
})

describe('一覧', () => {
  it('読みは辞書から作り、話す長さを見積もる（合計も）', async () => {
    const setup = setupNarration()
    await setup.send('PUT', `/projects/${setup.project.id}/audio-settings`, {
      readingDictionary: [{ written: '戦子', reading: 'せんこ' }],
      ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
    })
    await paste(setup, 'こんにちは\n戦子')

    const { lines, totalEstimatedSec } = await overview(setup)

    expect(lines.map((line) => [line.reading, line.readingIsManual, line.estimatedSec])).toEqual([
      ['こんにちは', false, 0.7],
      ['せんこ', false, 0.4],
    ])
    expect(totalEstimatedSec).toBeCloseTo(1.1)
  })

  it('同じ言葉に読みが 2 つある辞書は受け付けない（422）', async () => {
    const setup = setupNarration()
    const response = await setup.send('PUT', `/projects/${setup.project.id}/audio-settings`, {
      readingDictionary: [
        { written: '戦子', reading: 'せんこ' },
        { written: '戦子', reading: 'いくさこ' },
      ],
      ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
    })
    expect(response.status).toBe(422)
  })
})

describe('行を直す', () => {
  it('表示・読み（手で入れる）・演出・位置・テロップを直せる', async () => {
    const setup = setupNarration()
    await paste(setup, '進め')
    const [line] = (await overview(setup)).lines

    const response = await setup.send('PATCH', `/narration-lines/${String(line?.id)}`, {
      text: '進め！',
      reading: 'すすめ！',
      direction: '叫ぶように',
      startSec: 2.5,
      telop: false,
    })

    expect(response.status).toBe(200)
    expect((await overview(setup)).lines[0]).toMatchObject({ text: '進め！', reading: 'すすめ！', readingIsManual: true, startSec: 2.5 })
  })

  it('別の作品の声・ほかの行の Take は付けられない（422）', async () => {
    const setup = setupNarration()
    await paste(setup, 'いち\nに')
    const [first, second] = (await overview(setup)).lines
    const otherVoice = await setup.deps.voices.create({ projectId: setup.other.id, name: '他', tool: 'stub', voiceName: 'stub' })
    const take = await setup.deps.takes.create({
      lineId: second?.id as NarrationLineId,
      source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'stub', model: null, voiceName: 'stub' },
      mediaAssetId: newId(MediaAssetId),
      inSec: 0,
      outSec: 1,
      spokenText: 'に',
      displayText: 'に',
      specHash: null,
      charTimes: null,
      loudnessLufs: null,
      peaks: null,
      costUsd: 0,
    })

    expect((await setup.send('PATCH', `/narration-lines/${String(first?.id)}`, { voiceProfileId: otherVoice.id })).status).toBe(422)
    expect((await setup.send('PATCH', `/narration-lines/${String(first?.id)}`, { selectedTakeId: take.id })).status).toBe(422)
  })

  it('消す', async () => {
    const setup = setupNarration()
    await paste(setup, 'いち')
    const [line] = (await overview(setup)).lines

    expect((await setup.send('DELETE', `/narration-lines/${String(line?.id)}`)).status).toBe(204)
    expect((await overview(setup)).lines).toEqual([])
  })
})

describe('並べ替えと並べて置く', () => {
  it('並べ替えは作品の行を全部 1 度ずつ渡す（足りない・余計は 422）', async () => {
    const setup = setupNarration()
    await paste(setup, 'いち\nに\nさん')
    const ids = (await overview(setup)).lines.map((line) => line.id)

    const reordered = await setup.send('POST', `/projects/${setup.project.id}/narration/order`, { lineIds: [ids[2], ids[0], ids[1]] })
    const missing = await setup.send('POST', `/projects/${setup.project.id}/narration/order`, { lineIds: [ids[0], ids[1]] })

    expect(reordered.status).toBe(200)
    expect((await overview(setup)).lines.map((line) => line.text)).toEqual(['さん', 'いち', 'に'])
    expect(missing.status).toBe(422)
  })

  it('選んだ位置から、行を間を空けて順に置く（声が無ければ見積もりの長さで）', async () => {
    const setup = setupNarration()
    await paste(setup, 'こんにちは\nはい')

    const response = await setup.send('POST', `/projects/${setup.project.id}/narration/arrange`, { fromSec: 1, gapSec: 0.5 })

    expect(response.status).toBe(200)
    const { lines, endSec } = await overview(setup)
    expect(lines.map((line) => line.startSec)).toEqual([1, 2.2])
    expect(endSec).toBeCloseTo(2.2 + 0.3)
  })
})

describe('作り直しが要るか', () => {
  it('選んだ Take を作ったときと、読み・声・設定が変われば「作り直しが要る」', async () => {
    const setup = setupNarration()
    const voice = await setup.deps.voices.create({ projectId: setup.project.id, name: 'ナレーター', tool: 'stub', voiceName: 'stub' })
    await paste(setup, '進め', { voiceProfileId: voice.id })
    const [line] = setup.deps.lines.snapshot()
    if (line === undefined) throw new Error('行がありません')
    const specHash = await voiceSpecHash(voiceSpecOf(voice, line, lineReading(line, []).reading))
    const take = await setup.deps.takes.create({
      lineId: line.id,
      source: { type: 'generated', voiceJobId: newId(VoiceJobId), tool: 'stub', model: null, voiceName: 'stub' },
      mediaAssetId: newId(MediaAssetId),
      inSec: 0,
      outSec: 1.5,
      spokenText: '進め',
      displayText: '進め',
      specHash,
      charTimes: null,
      loudnessLufs: null,
      peaks: null,
      costUsd: 0,
    })
    await setup.send('PATCH', `/narration-lines/${line.id}`, { selectedTakeId: take.id })

    expect((await overview(setup)).lines[0]).toMatchObject({ stale: false, durationSec: 1.5 })

    await setup.send('PATCH', `/voices/${voice.id}`, { styleNote: '明るく' })
    expect((await overview(setup)).lines[0]?.stale).toBe(true)
  })
})
