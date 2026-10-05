import { describe, expect, it } from 'vitest'
import {
  MAX_READING_ENTRIES,
  ReadingDictionary,
  applyReadings,
  readingDictionaryProblem,
} from '../narration/reading.js'

/**
 * 読み辞書（制作者 2026-10-05 のナレーション。ADR-0038）。テロップは「表示」、AI には「読み」を渡す。
 * 読み間違えやすい言葉（戦子 → せんこ）を作品ごとに登録し、読みを作るときに置き換える。
 */

describe('applyReadings', () => {
  it('辞書の言葉を読みに置き換え、置き換えた区間と置き換えなかった区間を表示と読みの両方で持つ', () => {
    const applied = applyReadings('進め戦子ちゃん', [{ written: '戦子', reading: 'せんこ' }])

    expect(applied.reading).toBe('進めせんこちゃん')
    expect(applied.spans).toEqual([
      { display: { start: 0, end: 2 }, reading: { start: 0, end: 2 }, replaced: false },
      { display: { start: 2, end: 4 }, reading: { start: 2, end: 5 }, replaced: true },
      { display: { start: 4, end: 7 }, reading: { start: 5, end: 8 }, replaced: false },
    ])
  })

  it('同じ所に当たる言葉が複数あれば、長いほうを使う', () => {
    const applied = applyReadings('戦子ちゃん', [
      { written: '戦', reading: 'いくさ' },
      { written: '戦子ちゃん', reading: 'せんこちゃん' },
    ])

    expect(applied.reading).toBe('せんこちゃん')
  })

  it('辞書が空なら表示がそのまま読みになる（区間は 1 つ）', () => {
    expect(applyReadings('こんにちは', [])).toEqual({
      display: 'こんにちは',
      reading: 'こんにちは',
      spans: [{ display: { start: 0, end: 5 }, reading: { start: 0, end: 5 }, replaced: false }],
    })
  })

  it('区間は字（コードポイント）で数える（𠮷 のような 2 単位の字があってもずれない）', () => {
    const applied = applyReadings('𠮷田の戦子', [{ written: '戦子', reading: 'せんこ' }])

    expect(applied.spans.map((span) => span.display)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ])
  })

  it('空の表示は空の読み', () => {
    expect(applyReadings('', [{ written: '戦子', reading: 'せんこ' }])).toEqual({ display: '', reading: '', spans: [] })
  })
})

describe('ReadingDictionary', () => {
  it('前後の空白を落とし、空の言葉・読みは受け付けない', () => {
    expect(ReadingDictionary.parse([{ written: ' 戦子 ', reading: ' せんこ ' }])).toEqual([
      { written: '戦子', reading: 'せんこ' },
    ])
    expect(ReadingDictionary.safeParse([{ written: ' ', reading: 'せんこ' }]).success).toBe(false)
    expect(ReadingDictionary.safeParse([{ written: '戦子', reading: '' }]).success).toBe(false)
  })

  it(`登録できるのは ${MAX_READING_ENTRIES} 件まで`, () => {
    const many = Array.from({ length: MAX_READING_ENTRIES + 1 }, (_, i) => ({ written: `語${i}`, reading: 'ご' }))
    expect(ReadingDictionary.safeParse(many.slice(0, MAX_READING_ENTRIES)).success).toBe(true)
    expect(ReadingDictionary.safeParse(many).success).toBe(false)
  })
})

describe('readingDictionaryProblem', () => {
  it('同じ言葉を 2 回登録したら、どれかを言う', () => {
    expect(
      readingDictionaryProblem([
        { written: '戦子', reading: 'せんこ' },
        { written: '戦子', reading: 'いくさこ' },
      ]),
    ).toBe('「戦子」の読みが 2 つあります。1 つにしてください')
  })

  it('問題が無ければ null', () => {
    expect(readingDictionaryProblem([{ written: '戦子', reading: 'せんこ' }])).toBeNull()
  })
})
