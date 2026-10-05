import { describe, expect, it } from 'vitest'
import type { CharTime } from '../narration/char-timing.js'
import { applyReadings } from '../narration/reading.js'
import { displaySpeechWeights } from '../narration/speech-estimate.js'
import { NARRATION_TELOP_MAX_CHARS, splitTelopText, timeTelopChunks } from '../narration/telop-chunks.js'
import { MIN_TEXT_CLIP_DURATION_SEC } from '../timeline/text-template.js'

/**
 * ナレーションの 1 行を、テロップ何枚かに分けて時刻を付ける（ADR-0038）。
 * 分けるのは句点（。！？）、長ければ読点（、）。時刻は字の時刻があればそれ、無ければ読みの拍で按分する。
 */

describe('splitTelopText', () => {
  it('句点ごとに分ける（閉じかっこは前の文に付ける）', () => {
    expect(splitTelopText('勝負の時が来た。「行くぞ！」さあ').map((c) => c.text)).toEqual([
      '勝負の時が来た。',
      '「行くぞ！」',
      'さあ',
    ])
  })

  it('長い文は読点で分け、上限までまとめる', () => {
    const text = 'あいうえおかきくけこ、さしすせそたちつてと、なにぬねの'
    expect(splitTelopText(text, 12).map((c) => c.text)).toEqual(['あいうえおかきくけこ、', 'さしすせそたちつてと、', 'なにぬねの'])
    expect(splitTelopText(text, 24).map((c) => c.text)).toEqual(['あいうえおかきくけこ、さしすせそたちつてと、', 'なにぬねの'])
  })

  it('読点が無く上限を超える文は、上限の字数で切る', () => {
    expect(splitTelopText('あいうえおかきくけこ', 4).map((c) => c.text)).toEqual(['あいうえ', 'おかきく', 'けこ'])
  })

  it(`上限の既定は ${NARRATION_TELOP_MAX_CHARS} 字（2 行）`, () => {
    const sentence = 'あ'.repeat(NARRATION_TELOP_MAX_CHARS + 1)
    expect(splitTelopText(sentence).map((c) => [...c.text].length)).toEqual([NARRATION_TELOP_MAX_CHARS, 1])
  })

  it('前後の空白は落とし、区間は表示の字の位置で持つ', () => {
    expect(splitTelopText(' はい。 そう ')).toEqual([
      { text: 'はい。', range: { start: 1, end: 4 } },
      { text: 'そう', range: { start: 5, end: 7 } },
    ])
  })

  it('空や空白だけなら 0 枚', () => {
    expect(splitTelopText('  ')).toEqual([])
  })
})

const timed = (text: string, step: number): readonly CharTime[] =>
  [...text].map((char, index) => ({ char, startSec: index * step, endSec: (index + 1) * step }))

describe('timeTelopChunks', () => {
  it('字の時刻があれば、次の枚の最初の字が話されるときに切り替える（最初は 0 秒、最後は声の終わりまで）', () => {
    const display = 'あいうえ。かきくけ。'
    const chunks = splitTelopText(display)

    const timedChunks = timeTelopChunks({ display, chunks, durationSec: 2.4, displayTimes: timed(display, 0.2), weights: [] })

    expect(timedChunks.map(({ text, startSec, durationSec }) => ({ text, startSec, durationSec }))).toEqual([
      { text: 'あいうえ。', startSec: 0, durationSec: 1 },
      { text: 'かきくけ。', startSec: 1, durationSec: 1.4 },
    ])
  })

  it('字の時刻は、その枚の頭からの秒にして付ける（話している字を強調する字幕に使う）', () => {
    const display = 'あい。うえ。'
    const [, second] = timeTelopChunks({
      display,
      chunks: splitTelopText(display),
      durationSec: 1.2,
      displayTimes: timed(display, 0.2),
      weights: [],
    })

    expect(second?.chars?.map((c) => [c.char, Math.round(c.startSec * 10) / 10])).toEqual([
      ['う', 0],
      ['え', 0.2],
      ['。', 0.4],
    ])
  })

  it('字の時刻が無ければ、読みの拍で按分する（漢字の数ではない）', () => {
    // 「戦子」は 2 字だが、読み「せんこ」は 3 拍。前の枚「あ。」（1 拍 + 句点）より長くなる。
    const display = 'あ。戦子。'
    const applied = applyReadings(display, [{ written: '戦子', reading: 'せんこ' }])
    const weights = displaySpeechWeights(applied)

    const timedChunks = timeTelopChunks({ display, chunks: splitTelopText(display), durationSec: 2, displayTimes: null, weights })

    const [first, second] = timedChunks
    expect(first?.chars).toBeNull()
    expect(second?.durationSec).toBeGreaterThan(first?.durationSec ?? 0)
    expect((first?.durationSec ?? 0) + (second?.durationSec ?? 0)).toBeCloseTo(2)
  })

  it(`${MIN_TEXT_CLIP_DURATION_SEC} 秒に満たない枚は次の枚とまとめる（最後なら前の枚と）`, () => {
    const display = 'あ。いうえおかきくけこ。さしすせそたちつてと'
    const timedChunks = timeTelopChunks({
      display,
      chunks: splitTelopText(display),
      durationSec: 2.3,
      displayTimes: timed(display, 0.1),
      weights: [],
    })

    expect(timedChunks.map((c) => c.text)).toEqual(['あ。いうえおかきくけこ。', 'さしすせそたちつてと'])
    expect(timedChunks.every((c) => c.durationSec >= MIN_TEXT_CLIP_DURATION_SEC)).toBe(true)
  })

  it('声が短すぎて 1 枚ずつ出せなければ、全部を 1 枚にする', () => {
    const display = 'あ。い。'
    const timedChunks = timeTelopChunks({ display, chunks: splitTelopText(display), durationSec: 0.6, displayTimes: null, weights: [1, 0, 1, 0] })

    expect(timedChunks.map((c) => [c.text, c.startSec, c.durationSec])).toEqual([['あ。い。', 0, 0.6]])
  })
})
