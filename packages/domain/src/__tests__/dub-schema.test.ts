import { describe, expect, it } from 'vitest'
import { CharacterId, TakeId } from '../common/ids.js'
import { DialogueDub, MAX_DUB_STYLE_LENGTH, MAX_DUB_TIME_SEC } from '../dub/dialogue-dub.js'
import { DubParams } from '../dub/dub-record.js'
import { ProviderParams } from '../generation/take.js'
import { DialogueLine, DialogueLines, MAX_DIALOGUE_LINES } from '../shot/dialogue.js'

/** セリフの行の「差し替えの指定」と、差し替えた Take の記録（ADR-0062）。 */

const CAT = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const SOURCE = TakeId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB9')
const line = (dub?: unknown) => ({ speakerId: CAT, text: 'ねえ', ...(dub === undefined ? {} : { dub }) })

describe('DialogueLine の dub', () => {
  it('指定の無い行は鍵ごと無い（前からの行は 1 バイトも変わらない）', () => {
    const parsed = DialogueLine.parse(line())
    expect(JSON.stringify(parsed)).toBe(JSON.stringify({ speakerId: CAT, text: 'ねえ', offscreen: false, translation: null }))
  })

  it('全部の欄を持てる', () => {
    const dub = { style: '叱るように', placeAtSec: 1.2, fitSec: 2, levelDb: -6.5, keepOriginal: false, snap: false, startSec: 0.5, endSec: 1.5 }
    expect(DialogueLine.parse(line(dub)).dub).toEqual(dub)
  })

  it('知らない欄を拒む（strict）', () => {
    expect(DialogueDub.safeParse({ speed: 1.2 }).success).toBe(false)
  })

  it.each([
    ['読み方の指示が空', { style: '  ' }],
    ['読み方の指示が長すぎる', { style: 'あ'.repeat(MAX_DUB_STYLE_LENGTH + 1) }],
    ['置く時刻が負', { placeAtSec: -0.1 }],
    ['置く時刻が上限を超える', { placeAtSec: MAX_DUB_TIME_SEC + 0.1 }],
    ['置く時刻が数でない', { placeAtSec: Number.NaN }],
    ['収める長さが短すぎる', { fitSec: 0.05 }],
    ['切る長さが短すぎる', { cutSec: 0 }],
    ['距離が小さすぎる', { levelDb: -40.1 }],
    ['距離が大きすぎる', { levelDb: 12.1 }],
    ['収める長さと切る長さの両方', { fitSec: 1, cutSec: 1 }],
    ['区間の始まりだけ', { startSec: 1 }],
    ['区間の終わりが始まりより前', { startSec: 2, endSec: 1 }],
    ['足す行に置く時刻が無い', { added: true }],
    ['足す行で元の声のまま', { added: true, placeAtSec: 1, keepOriginal: true }],
    ['足す行に行の区間', { added: true, placeAtSec: 1, startSec: 0, endSec: 1 }],
    ['足す行でないのに音量を合わせる行', { levelLikeIndex: 0 }],
    ['音量を合わせる行の番号が上限を超える', { added: true, placeAtSec: 1, levelLikeIndex: MAX_DIALOGUE_LINES }],
    ['音量を合わせる行の番号が小数', { added: true, placeAtSec: 1, levelLikeIndex: 0.5 }],
    ['元の声のままで置く時刻', { keepOriginal: true, placeAtSec: 1 }],
    ['元の声のままで収める長さ', { keepOriginal: true, fitSec: 1 }],
    ['元の声のままで切る長さ', { keepOriginal: true, cutSec: 1 }],
    ['元の声のままで読み方の指示', { keepOriginal: true, style: '叱るように' }],
  ])('%s は拒む', (_label, dub) => {
    expect(DialogueDub.safeParse(dub).success).toBe(false)
  })

  it('足す行は置く時刻があれば通る', () => {
    expect(DialogueDub.safeParse({ added: true, placeAtSec: 1, levelLikeIndex: 0 }).success).toBe(true)
    expect(DialogueDub.safeParse({ added: true, placeAtSec: 1, levelLikeIndex: MAX_DIALOGUE_LINES - 1 }).success).toBe(true)
  })
})

describe('DialogueLines の音量を合わせる行', () => {
  const added = (levelLikeIndex: number) => line({ added: true, placeAtSec: 1, levelLikeIndex })

  it('足す行ではない別の行を指せば通る', () => {
    expect(DialogueLines.safeParse([line(), added(0)]).success).toBe(true)
  })

  it('行が無い・自分・足す行を指すと拒む', () => {
    expect(DialogueLines.safeParse([line(), added(5)]).success).toBe(false)
    expect(DialogueLines.safeParse([line(), added(1)]).success).toBe(false)
    expect(DialogueLines.safeParse([line(), added(2), added(1)]).success).toBe(false)
  })

  it('指定の無い行の並びは前と同じに通る', () => {
    expect(DialogueLines.parse([line(), line()])).toHaveLength(2)
  })
})

describe('ProviderParams の dub', () => {
  const record = {
    lineIndex: 0,
    mode: 'lip',
    added: false,
    sourceStartSec: 0.4,
    sourceEndSec: 1.6,
    placedStartSec: 0.36,
    placedEndSec: 1.66,
    agreement: 0.93,
    tempoMin: 1.1,
    tempoMax: 1.1,
    reading: 'plain',
    warnings: [],
  }
  const params = { kind: 'dub', sourceTakeId: SOURCE, voiceTool: 'gemini_api', model: 'gemini-3.8-flash-tts', integratedLufs: -16, lines: [record] }

  it('差し替えの記録を持てる', () => {
    expect(ProviderParams.parse(params)).toEqual(params)
    expect(DubParams.parse(params).lines[0]?.placedStartSec).toBe(0.36)
  })

  it.each([
    ['知らない欄', { ...params, extra: 1 }],
    ['行の記録の知らない欄', { ...params, lines: [{ ...record, note: 'x' }] }],
    ['一致率が 1 を超える', { ...params, lines: [{ ...record, agreement: 1.2 }] }],
    ['倍率が 0', { ...params, lines: [{ ...record, tempoMin: 0 }] }],
    ['知らない読み方', { ...params, lines: [{ ...record, reading: 'shout' }] }],
    ['元の Take が無い', { ...params, sourceTakeId: undefined }],
    ['置いた終わりが始まりより前', { ...params, lines: [{ ...record, placedStartSec: 1, placedEndSec: 0.5 }] }],
    ['伸縮の最小が最大より大きい', { ...params, lines: [{ ...record, tempoMin: 1.3, tempoMax: 1.1 }] }],
    ['足す行なのに元の区間がある', { ...params, lines: [{ ...record, added: true }] }],
    ['足す行でないのに元の区間が無い', { ...params, lines: [{ ...record, sourceStartSec: null, sourceEndSec: null }] }],
    ['元の区間の片方だけ', { ...params, lines: [{ ...record, sourceEndSec: null }] }],
  ])('%s は拒む', (_label, value) => {
    expect(ProviderParams.safeParse(value).success).toBe(false)
  })

  it('足す行は元の区間が null', () => {
    const added = { ...record, added: true, mode: 'place_at', sourceStartSec: null, sourceEndSec: null, agreement: null }
    expect(ProviderParams.safeParse({ ...params, lines: [added] }).success).toBe(true)
  })

  it('前からの種類（http・import）はそのまま通る', () => {
    const http = { kind: 'http', request: { a: 1 } }
    expect(JSON.stringify(ProviderParams.parse(http))).toBe(JSON.stringify(http))
    const imported = { kind: 'import', sourceModel: null, fileName: 'a.mp4' }
    expect(JSON.stringify(ProviderParams.parse(imported))).toBe(JSON.stringify(imported))
  })
})
