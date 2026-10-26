import { describe, expect, it } from 'vitest'
import { assignLines } from '../dub/assign-lines.js'
import { muteRanges } from '../dub/mute-ranges.js'
import { DUB_PAUSE_MARKER, pickReading, readingVariants, shouldStopTrying, spokenText } from '../dub/reading-variants.js'

/** 行の区間・元の声を消す範囲・読み方（ADR-0062）。 */

const c = (startSec: number, endSec: number) => ({ startSec, endSec })

describe('assignLines', () => {
  it('ふつうの行の数に合わせて、すき間の短い所から区間をつなぐ', () => {
    const result = assignLines([c(0.2, 0.5), c(0.55, 0.9), c(1.6, 2.2)], [{}, {}])
    expect(result).toEqual({
      ok: true,
      spans: [
        { lineIndex: 0, startSec: 0.2, endSec: 0.9, source: 'chunks', chunks: [c(0.2, 0.5), c(0.55, 0.9)] },
        { lineIndex: 1, startSec: 1.6, endSec: 2.2, source: 'chunks', chunks: [c(1.6, 2.2)] },
      ],
    })
  })

  it('足す行は数えない', () => {
    const result = assignLines([c(0.2, 0.9)], [{ dub: { added: true, placeAtSec: 2 } }, {}])
    expect(result.ok && result.spans).toEqual([{ lineIndex: 1, startSec: 0.2, endSec: 0.9, source: 'chunks', chunks: [c(0.2, 0.9)] }])
  })

  it('手の区間があればそれを使い、残りの区間を残りの行に割り当てる', () => {
    const result = assignLines([c(0.2, 0.9), c(1.0, 1.4), c(2.0, 2.5)], [{ dub: { startSec: 0.1, endSec: 1.5 } }, {}])
    expect(result.ok && result.spans).toEqual([
      { lineIndex: 0, startSec: 0.1, endSec: 1.5, source: 'manual', chunks: [c(0.2, 0.9), c(1, 1.4)] },
      { lineIndex: 1, startSec: 2, endSec: 2.5, source: 'chunks', chunks: [c(2, 2.5)] },
    ])
  })

  it('手の区間をまたいで区間をつながない（手の区間の前と後の行は、それぞれの側の区間だけを使う）', () => {
    // すき間が一番短いのは手の区間をまたぐ 0.9〜1.4 だが、そこはつながない。
    const chunks = [c(0.1, 0.3), c(0.9, 1.0), c(1.1, 1.2), c(1.4, 1.6)]
    const result = assignLines(chunks, [{}, { dub: { startSec: 1.05, endSec: 1.3 } }, {}])
    expect(result.ok && result.spans).toEqual([
      { lineIndex: 0, startSec: 0.1, endSec: 1, source: 'chunks', chunks: [c(0.1, 0.3), c(0.9, 1)] },
      { lineIndex: 1, startSec: 1.05, endSec: 1.3, source: 'manual', chunks: [c(1.1, 1.2)] },
      { lineIndex: 2, startSec: 1.4, endSec: 1.6, source: 'chunks', chunks: [c(1.4, 1.6)] },
    ])
  })

  it('手の区間の前の行に区間が無ければ、後ろの区間を回さずに止める', () => {
    const chunks = [c(1.0, 1.4), c(2.0, 2.3), c(2.4, 2.6)]
    const result = assignLines(chunks, [{}, { dub: { startSec: 0.9, endSec: 1.5 } }, {}])
    expect(result.ok).toBe(false)
  })

  it('区間が足りなければ、全部の行に手の区間があれば通る', () => {
    const result = assignLines([c(0.2, 2.0)], [{ dub: { startSec: 0.2, endSec: 1.0 } }, { dub: { startSec: 1.0, endSec: 2.0 } }])
    expect(result.ok && result.spans.map((span) => span.source)).toEqual(['manual', 'manual'])
  })

  it('区間が足りず手の区間も無ければ、理由を付けて止める', () => {
    const result = assignLines([c(0.2, 2.0)], [{}, {}])
    expect(result).toEqual({
      ok: false,
      reason:
        'セリフの 1・2 行目に割り当てる元の声の区間が足りません（見つかったのは 1 つ。2 人のセリフが続けて 1 つになっている可能性があります）。' +
        '行ごとに「行の区間」を入れてください',
    })
  })
})

describe('muteRanges', () => {
  it('行の [始まり -0.05, 終わり +0.1] を消す', () => {
    expect(muteRanges([{ startSec: 1, endSec: 2 }], [])).toEqual([c(0.95, 2.1)])
  })

  it('前後 0.3 秒以内の声の区間まで広げる', () => {
    const chunks = [c(0.5, 0.7), c(2.3, 2.6), c(3.0, 3.2)]
    expect(muteRanges([{ startSec: 1, endSec: 2 }], chunks)).toEqual([c(0.5, 2.6)])
  })

  it('snap: false の行は広げない、元の声のままの行は消さない', () => {
    const chunks = [c(0.5, 0.7)]
    expect(muteRanges([{ startSec: 1, endSec: 2, snap: false }], chunks)).toEqual([c(0.95, 2.1)])
    expect(muteRanges([{ startSec: 1, endSec: 2, keepOriginal: true }], chunks)).toEqual([])
  })

  it('元の声のままの行の区間には広げない（その声は残す）', () => {
    const lines = [{ startSec: 1, endSec: 2 }, { startSec: 2.3, endSec: 2.6, keepOriginal: true }]
    expect(muteRanges(lines, [c(1, 2), c(2.3, 2.6)])).toEqual([c(0.95, 2.1)])
  })

  it('重なる範囲は 1 つにまとめ、0 秒より前には出ない', () => {
    expect(muteRanges([{ startSec: 0.02, endSec: 1 }, { startSec: 1.1, endSec: 1.5 }], [])).toEqual([c(0, 1.6)])
  })
})

describe('readingVariants', () => {
  it('素の文・句読点の後に間・読点を外した文の 3 通り', () => {
    expect(readingVariants('ねえ、ネズミくん。待って！')).toEqual([
      { kind: 'plain', text: 'ねえ、ネズミくん。待って！' },
      { kind: 'pause', text: `ねえ、${DUB_PAUSE_MARKER}ネズミくん。${DUB_PAUSE_MARKER}待って！` },
      { kind: 'no_comma', text: 'ねえネズミくん。待って！' },
    ])
  })

  it('同じ文になる読み方は省く', () => {
    expect(readingVariants('はい')).toEqual([{ kind: 'plain', text: 'はい' }])
    expect(readingVariants('はい。そう')).toHaveLength(2)
  })

  it('頭の「……」は読まない', () => {
    expect(spokenText('……ねえ')).toBe('ねえ')
    expect(readingVariants('……はい')[0]?.text).toBe('はい')
  })
})

describe('shouldStopTrying / pickReading', () => {
  it('数が合い一致率 0.9 以上で打ち切る', () => {
    expect(shouldStopTrying({ countsMatched: true, agreement: 0.9 })).toBe(true)
    expect(shouldStopTrying({ countsMatched: false, agreement: 0.95 })).toBe(false)
    expect(shouldStopTrying({ countsMatched: true, agreement: 0.89 })).toBe(false)
    expect(shouldStopTrying({ countsMatched: true, agreement: null })).toBe(false)
  })

  it('一致率の一番高いもの（同じなら先に試したもの）', () => {
    const tries = [
      { kind: 'plain', agreement: 0.8 },
      { kind: 'pause', agreement: 0.85 },
      { kind: 'no_comma', agreement: 0.85 },
    ] as const
    expect(pickReading(tries)?.kind).toBe('pause')
    expect(pickReading([])).toBeNull()
  })

  it('どれも一致率が測れなければ、最初に試したもの', () => {
    const tries = [
      { kind: 'plain', agreement: null },
      { kind: 'pause', agreement: null },
    ] as const
    expect(pickReading(tries)?.kind).toBe('plain')
  })
})
