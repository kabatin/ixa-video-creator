import { describe, expect, it } from 'vitest'
import type { CharTime } from '../narration/char-timing.js'
import { NARRATION_TELOP_HOLD_SEC, narrationTelopSpans } from '../narration/narration-telops.js'
import { linesFromTranscript } from '../narration/transcript-lines.js'
import { toSrt } from '../timeline/srt.js'

/**
 * - ナレーションのテロップをタイムラインの秒にする（行の位置 + 枚の時刻。読み終わりに少し残す）
 * - 録音の文字起こしを行に分ける
 * - テロップを字幕ファイル（SRT）にする
 */

describe('narrationTelopSpans', () => {
  it('行の位置に枚の時刻を足す。行の最後の枚は少し残すが、次のテロップに重ねない', () => {
    const spans = narrationTelopSpans([
      {
        lineId: 'a',
        startSec: 10,
        chunks: [
          { text: 'あ', startSec: 0, durationSec: 1, chars: null },
          { text: 'い', startSec: 1, durationSec: 1, chars: null },
        ],
      },
      { lineId: 'b', startSec: 12.1, chunks: [{ text: 'う', startSec: 0, durationSec: 1, chars: null }] },
    ])

    expect(spans.map(({ lineId, chunkIndex, text, startSec, durationSec }) => ({ lineId, chunkIndex, text, startSec, durationSec }))).toEqual([
      { lineId: 'a', chunkIndex: 0, text: 'あ', startSec: 10, durationSec: 1 },
      { lineId: 'a', chunkIndex: 1, text: 'い', startSec: 11, durationSec: 1.1 },
      { lineId: 'b', chunkIndex: 0, text: 'う', startSec: 12.1, durationSec: 1 + NARRATION_TELOP_HOLD_SEC },
    ])
  })
})

const say = (text: string, from: number, step = 0.1): readonly CharTime[] =>
  [...text].map((char, index) => ({ char, startSec: from + index * step, endSec: from + (index + 1) * step }))

describe('linesFromTranscript', () => {
  it('句点と、長い間（0.6 秒以上）で行を分ける。行の始まりと終わりは最初と最後の字', () => {
    const chars = [...say('はじめまして。わたしは', 0), ...say('せんこです', 3)]

    expect(linesFromTranscript(chars).map(({ text, startSec, endSec }) => ({ text, startSec, endSec }))).toEqual([
      { text: 'はじめまして。', startSec: 0, endSec: 0.7 },
      { text: 'わたしは', startSec: 0.7, endSec: 1.1 },
      { text: 'せんこです', startSec: 3, endSec: 3.5 },
    ])
  })

  it('行の字の時刻は、その行の頭からの秒', () => {
    const [line] = linesFromTranscript(say('はい', 2))
    expect(line?.chars.map((c) => [c.char, Math.round(c.startSec * 10) / 10])).toEqual([
      ['は', 0],
      ['い', 0.1],
    ])
  })

  it('空白だけの行は作らない。前後の空白は落とす', () => {
    expect(linesFromTranscript([...say(' ', 0), ...say(' はい ', 5)]).map((l) => l.text)).toEqual(['はい'])
  })

  it('長すぎる行は上限の字数で分ける', () => {
    expect(linesFromTranscript(say('あいうえおかきくけこ', 0), { maxChars: 4 }).map((l) => l.text)).toEqual([
      'あいうえ',
      'おかきく',
      'けこ',
    ])
  })
})

describe('toSrt', () => {
  it('始まりの順に番号を振り、時:分:秒,ミリ秒 で書く', () => {
    expect(
      toSrt([
        { startSec: 61.5, endSec: 63, text: '二つ目' },
        { startSec: 1, endSec: 2.25, text: '一つ目' },
      ]),
    ).toBe('1\n00:00:01,000 --> 00:00:02,250\n一つ目\n\n2\n00:01:01,500 --> 00:01:03,000\n二つ目\n')
  })

  it('空の字は飛ばし、字の中の空行は詰める（SRT では空行が区切りになる）', () => {
    expect(
      toSrt([
        { startSec: 0, endSec: 1, text: '  ' },
        { startSec: 3600, endSec: 3601, text: '上\n\n下' },
      ]),
    ).toBe('1\n01:00:00,000 --> 01:00:01,000\n上\n下\n')
  })

  it('何も無ければ空', () => {
    expect(toSrt([])).toBe('')
  })
})
