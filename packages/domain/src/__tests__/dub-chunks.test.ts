import { describe, expect, it } from 'vitest'
import { agreement, voicedMask } from '../dub/agreement.js'
import { mergeChunksTo, pairChunks } from '../dub/pair-chunks.js'
import { speechChunks, trimBounds, voicedLevelDb } from '../dub/speech-chunks.js'

/**
 * 声の区間・組・一致率（ADR-0062）。値は AnimalVideo で実際に動いている作り（10ms 刻み・最大 -30 dB・
 * 0.12 秒未満の途切れはつなぐ・0.06 秒未満は捨てる）。
 */

/** 10ms 刻みの dB の列。`[開始秒, 終了秒, dB]` の所だけ鳴らし、他は -80 dB。 */
const frames = (durationSec: number, voiced: readonly (readonly [number, number, number])[]): number[] =>
  Array.from({ length: Math.round(durationSec * 100) }, (_, i) => {
    const t = i / 100 + 0.005
    return voiced.find(([s, e]) => t >= s && t < e)?.[2] ?? -80
  })

const c = (startSec: number, endSec: number) => ({ startSec, endSec })

describe('speechChunks', () => {
  it('最大 -30 dB より上を声の区間にする', () => {
    expect(speechChunks(frames(2, [[0.5, 1.0, -20], [1.5, 1.8, -25]]))).toEqual([c(0.5, 1), c(1.5, 1.8)])
  })

  it('最大より 30 dB 以上小さい音（環境音）は声にしない', () => {
    expect(speechChunks(frames(2, [[0.2, 0.6, -55], [1.0, 1.4, -20]]))).toEqual([c(1, 1.4)])
  })

  it('0.12 秒未満の途切れはつなぎ、0.12 秒以上は分ける', () => {
    expect(speechChunks(frames(2, [[0.2, 0.5, -20], [0.61, 0.9, -20]]))).toEqual([c(0.2, 0.9)])
    expect(speechChunks(frames(2, [[0.2, 0.5, -20], [0.62, 0.9, -20]]))).toEqual([c(0.2, 0.5), c(0.62, 0.9)])
  })

  it('0.06 秒未満の区間（物音）は捨てる', () => {
    expect(speechChunks(frames(2, [[0.2, 0.25, -20], [1.0, 1.06, -20]]))).toEqual([c(1, 1.06)])
  })

  it('空・無音は区間なし', () => {
    expect(speechChunks([])).toEqual([])
    expect(speechChunks([Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY])).toEqual([])
  })
})

describe('trimBounds', () => {
  it('-45 dB より小さい頭と尻を落とし、0.15 秒ずつ残す', () => {
    expect(trimBounds(frames(2, [[0.5, 1.2, -30]]), 2)).toEqual(c(0.35, 1.35))
  })

  it('端からは出ない', () => {
    expect(trimBounds(frames(1, [[0.05, 0.98, -30]]), 1)).toEqual(c(0, 1))
  })

  it('全部小さければ null', () => {
    expect(trimBounds(frames(1, [[0.2, 0.5, -50]]), 1)).toBeNull()
  })
})

describe('voicedLevelDb', () => {
  it('最大 -25 dB より上の区切りだけの大きさ（力の平均）', () => {
    expect(voicedLevelDb([-20, -20, -80, -80, -80])).toBeCloseTo(-20, 6)
    expect(voicedLevelDb([-20, -23, -60])).toBeCloseTo(10 * Math.log10((10 ** -2 + 10 ** -2.3) / 2), 6)
  })

  it('音が無ければ null', () => {
    expect(voicedLevelDb([])).toBeNull()
    expect(voicedLevelDb([Number.NEGATIVE_INFINITY])).toBeNull()
  })
})

describe('mergeChunksTo', () => {
  it('すき間の短い所からつないで数をそろえる', () => {
    const chunks = [c(0, 0.3), c(0.5, 0.8), c(0.85, 1.0), c(1.5, 1.8)]
    expect(mergeChunksTo(chunks, 3)).toEqual([[c(0, 0.3)], [c(0.5, 0.8), c(0.85, 1)], [c(1.5, 1.8)]])
    expect(mergeChunksTo(chunks, 1)).toEqual([chunks])
  })

  it('数が足りていればそのまま 1 つずつ', () => {
    expect(mergeChunksTo([c(0, 1)], 3)).toEqual([[c(0, 1)]])
  })
})

describe('pairChunks', () => {
  it('同じ数なら 1 対 1', () => {
    const result = pairChunks([c(0, 0.5), c(1, 1.4)], [c(2, 2.6), c(3, 3.3)])
    expect(result.countsMatched).toBe(true)
    expect(result.pairs).toEqual([
      { tts: [c(0, 0.5)], source: c(2, 2.6) },
      { tts: [c(1, 1.4)], source: c(3, 3.3) },
    ])
  })

  it('読み上げの方が多ければ、読み上げの区間をつないで組む（中の区間は残す）', () => {
    const result = pairChunks([c(0, 0.3), c(0.4, 0.6), c(1.2, 1.5)], [c(2, 2.6), c(3, 3.3)])
    expect(result.countsMatched).toBe(false)
    expect(result.pairs).toEqual([
      { tts: [c(0, 0.3), c(0.4, 0.6)], source: c(2, 2.6) },
      { tts: [c(1.2, 1.5)], source: c(3, 3.3) },
    ])
  })

  it('元の方が多ければ、元の区間をつないで 1 つの区間にする', () => {
    const result = pairChunks([c(0, 0.9)], [c(2, 2.3), c(2.4, 2.8)])
    expect(result.pairs).toEqual([{ tts: [c(0, 0.9)], source: c(2, 2.8) }])
  })

  it('どちらかが空なら組まない', () => {
    expect(pairChunks([], [c(0, 1)]).pairs).toEqual([])
  })
})

describe('agreement', () => {
  it('10ms ごとの「話す／黙る」が同じ割合', () => {
    const source = voicedMask([c(0.1, 0.5)], 0, 1)
    const placed = voicedMask([c(0.2, 0.5)], 0, 1)
    expect(source).toHaveLength(100)
    expect(agreement(source, placed)).toBeCloseTo(0.9, 6)
    expect(agreement(source, source)).toBe(1)
  })

  it('長さが違えば、足りない方は黙っているとみなす', () => {
    expect(agreement([true, true], [true])).toBe(0.5)
  })

  it('比べる区切りが無ければ null', () => {
    expect(agreement([], [])).toBeNull()
  })
})
