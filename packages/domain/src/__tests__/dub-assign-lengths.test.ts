import { describe, expect, it } from 'vitest'
import { assignLines } from '../dub/assign-lines.js'
import { planLipPair } from '../dub/chunk-tempo.js'

/**
 * 行の区間を、読み上げの長さで決める（ADR-0062）。行の順は変えず、声の区間の続いた並びを 1 行に割り当て、
 * 声でない区間（クリック・環境音）は飛ばしてよい。
 */

const c = (startSec: number, endSec: number) => ({ startSec, endSec })
const tts = (entries: readonly (readonly [number, readonly number[]])[]) => new Map(entries)
const spansOf = (result: ReturnType<typeof assignLines>) =>
  result.ok ? result.spans.map((span) => [span.lineIndex, span.startSec, span.endSec, span.source]) : result.reason

describe('assignLines（読み上げの長さで割り当てる）', () => {
  it('実際の H3 の Take、文字起こしが無いとき: 頭のクリックを飛ばし、長さの合う区間を選ぶ（本当の区間は 1 行目 1.57〜4.13・2 行目 4.86〜6.28。長さだけでは外れるので文字起こしで正す。dub-assign-text.test.ts）', () => {
    const chunks = [c(0.0, 0.15), c(1.57, 2.45), c(2.97, 3.69), c(3.76, 4.13), c(4.86, 5.0), c(5.46, 6.03), c(6.07, 6.28)]
    const result = assignLines(chunks, [{ text: 'ねえ、ネズミくん。' }, { text: 'な、なんですか。' }], tts([[0, [1.39]], [1, [1.16]]]))
    expect(result).toEqual({
      ok: true,
      spans: [
        { lineIndex: 0, startSec: 1.57, endSec: 2.45, source: 'chunks', chunks: [c(1.57, 2.45)] },
        { lineIndex: 1, startSec: 2.97, endSec: 4.13, source: 'chunks', chunks: [c(2.97, 3.69), c(3.76, 4.13)] },
      ],
      warnings: [],
    })
  })

  it('頭がクリックだけでも、そこを行に割り当てない', () => {
    const result = assignLines([c(0.0, 0.15), c(1.0, 2.0)], [{ text: 'あいうえお' }], tts([[0, [1.0]]]))
    expect(spansOf(result)).toEqual([[0, 1.0, 2.0, 'chunks']])
  })

  it('尻の環境音を、最後の行につながない', () => {
    const result = assignLines([c(0.5, 1.5), c(2.0, 2.2), c(2.6, 2.75)], [{ text: 'あいうえお' }], tts([[0, [1.0]]]))
    expect(spansOf(result)).toEqual([[0, 0.5, 1.5, 'chunks']])
  })

  it('3 行: クリックと尻の環境音を飛ばし、途中の短い途切れはつなぐ', () => {
    const chunks = [c(0.0, 0.12), c(0.5, 1.3), c(1.8, 2.4), c(2.45, 2.7), c(3.2, 4.0), c(4.5, 4.6)]
    const result = assignLines(chunks, [{ text: 'あ' }, { text: 'い' }, { text: 'う' }], tts([[0, [0.8]], [1, [0.85]], [2, [0.8]]]))
    expect(spansOf(result)).toEqual([
      [0, 0.5, 1.3, 'chunks'],
      [1, 1.8, 2.7, 'chunks'],
      [2, 3.2, 4.0, 'chunks'],
    ])
  })

  it('間の行に手の区間があれば、それを境に前と後ろをそれぞれ読み上げの長さで割り当てる', () => {
    const chunks = [c(0.0, 0.1), c(0.5, 1.2), c(1.5, 2.0), c(2.5, 3.3), c(3.6, 3.7)]
    const lines = [{ text: 'あ' }, { text: 'い', dub: { startSec: 1.4, endSec: 2.1 } }, { text: 'う' }]
    const result = assignLines(chunks, lines, tts([[0, [0.7]], [2, [0.8]]]))
    expect(spansOf(result)).toEqual([
      [0, 0.5, 1.2, 'chunks'],
      [1, 1.4, 2.1, 'manual'],
      [2, 2.5, 3.3, 'chunks'],
    ])
  })

  it('とても短い区間（0.25 秒未満）は、読み上げがそれほど短くなければ選びにくくする', () => {
    // 倍率だけなら 0.24 秒の区間 1 つ（1.25 倍）が一番近いが、0.25 秒未満なので 2 つをつないだ並びを選ぶ。
    const result = assignLines([c(0.0, 0.2), c(1.0, 1.24), c(1.74, 1.87)], [{ text: 'あ' }], tts([[0, [0.3]]]))
    expect(spansOf(result)).toEqual([[0, 1.0, 1.87, 'chunks']])
  })

  it('どの読み方でも 1.6 倍を超えるなら、どの行かを言い、手の区間の案を付けて止める', () => {
    const result = assignLines([c(0.0, 0.15), c(1.0, 1.3)], [{ text: 'あいうえお' }], tts([[0, [1.4, 2.0]]]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.cause).toBe('no_fit')
    expect(result.lineIndices).toEqual([0])
    expect(result.reason).toMatch(/^セリフの 1 行目/)
    expect(result.reason).toContain('行の区間')
    expect(result.suggestions).toEqual([{ lineIndex: 0, startSec: 0, endSec: 1.3 }])
  })

  it('倍率だけなら近くても 1.6 倍を超える区間より、収まる区間を選ぶ', () => {
    // 頭の 0.62 秒（1.61 倍）は倍率の差だけなら近いが収まらない。後ろの 2 つ（途切れ 0.3 秒、1.43 倍）を選ぶ。
    const result = assignLines([c(0.0, 0.62), c(2.0, 2.4), c(2.7, 3.0)], [{ text: 'あ' }], tts([[0, [1.0]]]))
    expect(spansOf(result)).toEqual([[0, 2.0, 3.0, 'chunks']])
  })

  it('同じ声の続きの短い区間は、飛ばすより行に含める', () => {
    const result = assignLines([c(0.0, 0.9), c(0.95, 1.15)], [{ text: 'あ' }], tts([[0, [1.0]]]))
    expect(spansOf(result)).toEqual([[0, 0.0, 1.15, 'chunks']])
  })

  it('H3 がゆっくり話した行（0.8 倍未満）も割り当て、倍率は 0.8 に丸めて警告する（前と同じ）', () => {
    const result = assignLines([c(0.0, 0.15), c(1.0, 2.0)], [{ text: 'あ' }], tts([[0, [0.5]]]))
    expect(spansOf(result)).toEqual([[0, 1.0, 2.0, 'chunks']])
    // 置く段の倍率（読み上げ 0.5 秒 ÷ 元の声 1.0 秒）は 0.8 に丸め、警告を付ける。
    const plan = planLipPair(
      { tts: [c(0.2, 0.7)], source: c(1.0, 2.0) },
      { ttsDurationSec: 0.9, nextSourceStartSec: null, shotDurationSec: 3 },
    )
    expect(plan.ok && plan.tempo).toBe(0.8)
    expect(plan.ok && plan.warnings.map((w) => w.code)).toEqual(['slow_tempo_clamped'])
  })

  it('どれか 1 つの読み方で収まれば、それで割り当てる', () => {
    const result = assignLines([c(0.0, 0.15), c(1.0, 1.3)], [{ text: 'あいうえお' }], tts([[0, [1.4, 0.4]]]))
    expect(spansOf(result)).toEqual([[0, 1.0, 1.3, 'chunks']])
  })

  it('次に良い割り当てとほとんど差が無ければ、良い方を使い、その行の名前を入れた警告を付ける', () => {
    const result = assignLines([c(0.5, 1.0), c(1.6, 2.1)], [{ text: 'あ' }], tts([[0, [0.5]]]))
    expect(spansOf(result)).toEqual([[0, 0.5, 1.0, 'chunks']])
    expect(result.ok && result.warnings.map((w) => [w.lineIndex, w.warning.code])).toEqual([[0, 'line_span_ambiguous']])
    expect(result.ok && result.warnings[0]?.warning.message).toMatch(/^セリフの 1 行目/)
  })

  it('はっきり決まるときは警告を付けない', () => {
    const result = assignLines([c(0.5, 1.0), c(1.6, 2.4)], [{ text: 'あ' }], tts([[0, [0.8]]]))
    expect(spansOf(result)).toEqual([[0, 1.6, 2.4, 'chunks']])
    expect(result.ok && result.warnings).toEqual([])
  })

  it('読み上げの長さの無い行（元の声のままの行）は、長さを比べずに残りの区間を受け持つ', () => {
    const result = assignLines([c(0.5, 1.2), c(1.8, 2.4)], [{ text: 'あ' }, { text: 'い', dub: { keepOriginal: true } }], tts([[0, [0.75]]]))
    expect(spansOf(result)).toEqual([
      [0, 0.5, 1.2, 'chunks'],
      [1, 1.8, 2.4, 'chunks'],
    ])
  })
})
