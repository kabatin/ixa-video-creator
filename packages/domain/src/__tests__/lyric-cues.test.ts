import { describe, expect, it } from 'vitest'
import {
  LYRIC_TELOP_MAX_SEC,
  lyricCuesProblem,
  lyricLines,
  lyricTelopSpans,
  lyricsDuring,
} from '../lyrics/lyric-cues.js'
import {
  MIN_TEXT_CLIP_DURATION_SEC,
  lyricLineOf,
  parseTextClipParams,
} from '../timeline/text-template.js'

/**
 * 歌詞（制作者 2026-10-01「歌詞は明確に入力するところを」「1 フレーズごとにテロップを自動生成」）。
 * 1 行 = 1 フレーズ。時刻は聴きながら Enter で打つ（行ごとの頭の秒）。
 */

describe('lyricLines', () => {
  it('1 行を 1 フレーズにし、前後の空白と空行（歌の区切り）を落とす', () => {
    expect(lyricLines('  夜明けの屋上で \n\n君を待ってた\r\n  ')).toEqual(['夜明けの屋上で', '君を待ってた'])
    expect(lyricLines('')).toEqual([])
  })
})

describe('lyricCuesProblem', () => {
  it('行の順に増えていく 0 以上の秒なら問題なし', () => {
    expect(lyricCuesProblem([0, 1.5, 3.25])).toBeNull()
    expect(lyricCuesProblem([])).toBeNull()
  })

  it('戻る・同じ・負・数でない時刻は断る', () => {
    expect(lyricCuesProblem([2, 1])).not.toBeNull()
    expect(lyricCuesProblem([1, 1])).not.toBeNull()
    expect(lyricCuesProblem([-0.1])).not.toBeNull()
    expect(lyricCuesProblem([Number.NaN])).not.toBeNull()
  })
})

describe('lyricTelopSpans', () => {
  const lines = ['一行目', '二行目', '三行目']

  it('次のフレーズの頭まで出し、最後は曲の終わりまで（長すぎれば上限で切る）', () => {
    expect(lyricTelopSpans(lines, [1, 3, 5], 8)).toEqual([
      { lineIndex: 0, text: '一行目', startSec: 1, durationSec: 2 },
      { lineIndex: 1, text: '二行目', startSec: 3, durationSec: 2 },
      { lineIndex: 2, text: '三行目', startSec: 5, durationSec: 3 },
    ])
  })

  it('間奏で次まで長く空くときは上限で切る', () => {
    const spans = lyricTelopSpans(lines, [1, 30], 60)
    expect(spans[0]?.durationSec).toBe(LYRIC_TELOP_MAX_SEC)
    expect(spans[1]?.durationSec).toBe(LYRIC_TELOP_MAX_SEC)
  })

  it('時刻の無い行は置かない（まだ合わせていない）', () => {
    expect(lyricTelopSpans(lines, [1], 8).map((span) => span.lineIndex)).toEqual([0])
  })

  it('読めないほど短い（テロップの最短未満）フレーズは置かない', () => {
    const spans = lyricTelopSpans(lines, [1, 1 + MIN_TEXT_CLIP_DURATION_SEC / 2, 4], 8)
    expect(spans.map((span) => span.lineIndex)).toEqual([1, 2])
  })

  it('曲の終わりより後の行は置かない', () => {
    expect(lyricTelopSpans(lines, [1, 9], 8).map((span) => span.lineIndex)).toEqual([0])
  })
})

describe('lyricsDuring', () => {
  it('Shot の間に歌い出すフレーズだけを返す（絵コンテの案に渡す）', () => {
    const lines = ['一行目', '二行目', '三行目', '四行目']
    const cues = [0.5, 2, 4, 6]
    expect(lyricsDuring(lines, cues, { startSec: 1.5, durationSec: 3 })).toEqual(['二行目', '三行目'])
    expect(lyricsDuring(lines, cues, { startSec: 4.5, durationSec: 1 })).toEqual([])
  })
})

/** 歌詞から置いたテロップの印。置き直すとき差し替える相手を探す（手で置いたテロップは触らない）。 */
describe('lyricLineOf / parseTextClipParams', () => {
  it('印があれば何行目かを返し、無ければ null', () => {
    expect(lyricLineOf({ text: 'a', lyricLine: 3 })).toBe(3)
    expect(lyricLineOf({ text: 'a' })).toBeNull()
    expect(lyricLineOf({ text: 'a', lyricLine: -1 })).toBeNull()
  })

  it('読み直しても印を落とさない', () => {
    expect(parseTextClipParams({ text: 'a', lyricLine: 2 })).toEqual({ text: 'a', lyricLine: 2 })
  })
})
