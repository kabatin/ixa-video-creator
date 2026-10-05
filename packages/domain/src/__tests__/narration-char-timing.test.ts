import { describe, expect, it } from 'vitest'
import { alignTimedText, charTimesFromSegments, displayTimesFromReading, type CharTime } from '../narration/char-timing.js'
import { applyReadings } from '../narration/reading.js'

/**
 * 字の時刻を、テロップに出す字（表示）へ写す（ADR-0038）。
 * - ElevenLabs は読み（送った字）の 1 字ごとに時刻を返す → 読み辞書の区間で表示へ写し戻す
 * - 文字起こしは聞き取った字に時刻を付ける → 表示と突き合わせ、合わない字は前後から割り振る
 */

const timed = (text: string, step = 0.1, from = 0): readonly CharTime[] =>
  [...text].map((char, index) => ({ char, startSec: from + index * step, endSec: from + (index + 1) * step }))

const round = (times: readonly CharTime[]) =>
  times.map((t) => ({ char: t.char, startSec: Math.round(t.startSec * 1000) / 1000, endSec: Math.round(t.endSec * 1000) / 1000 }))

describe('displayTimesFromReading', () => {
  it('置き換えなかった字はそのまま、置き換えた言葉は読みの区間を表示の字数で等分する', () => {
    const applied = applyReadings('進め戦子', [{ written: '戦子', reading: 'せんこ' }])

    const display = displayTimesFromReading(applied, timed('進めせんこ'))

    expect(round(display)).toEqual([
      { char: '進', startSec: 0, endSec: 0.1 },
      { char: 'め', startSec: 0.1, endSec: 0.2 },
      { char: '戦', startSec: 0.2, endSec: 0.35 },
      { char: '子', startSec: 0.35, endSec: 0.5 },
    ])
  })

  it('2 単位の字（𠮷）があっても、表示の字と時刻がずれない', () => {
    const applied = applyReadings('𠮷戦子', [{ written: '戦子', reading: 'せんこ' }])

    const display = displayTimesFromReading(applied, timed('𠮷せんこ'))

    expect(display.map((t) => t.char)).toEqual(['𠮷', '戦', '子'])
    expect(round(display)).toEqual([
      { char: '𠮷', startSec: 0, endSec: 0.1 },
      { char: '戦', startSec: 0.1, endSec: 0.25 },
      { char: '子', startSec: 0.25, endSec: 0.4 },
    ])
  })

  it('読みの字数と時刻の数が合わなければ投げる（送った字と違うものに時刻が付いている）', () => {
    const applied = applyReadings('進め', [])
    expect(() => displayTimesFromReading(applied, timed('すすめ'))).toThrow(/字の時刻/)
  })
})

describe('alignTimedText', () => {
  it('同じ字なら同じ時刻', () => {
    expect(round(alignTimedText(timed('こんにちは'), 'こんにちは'))).toEqual(round(timed('こんにちは')))
  })

  it('カタカナとひらがな、全角と半角の違いは同じ字として扱う', () => {
    const times = alignTimedText(timed('ラーメンＡ'), 'らーめんA')
    expect(times.map((t) => t.startSec)).toEqual(timed('ラーメンＡ').map((t) => t.startSec))
  })

  it('表示にしか無い字（句読点など）は、前の字の終わりに長さ 0 で置く', () => {
    const times = round(alignTimedText(timed('はいそう'), 'はい、そう'))
    expect(times[2]).toEqual({ char: '、', startSec: 0.2, endSec: 0.2 })
    expect(times[3]).toEqual({ char: 'そ', startSec: 0.2, endSec: 0.3 })
  })

  it('聞き違えた字は、前後の合った字のあいだを字数で割り振る', () => {
    // 「戦子」を「線香」と聞き取った。「戦」「子」は「は」の終わり（0.4）から「が」の始まり（0.6）までを分ける。
    const times = round(alignTimedText(timed('わたしは線香が'), 'わたしは戦子が'))
    expect(times[4]).toEqual({ char: '戦', startSec: 0.4, endSec: 0.5 })
    expect(times[5]).toEqual({ char: '子', startSec: 0.5, endSec: 0.6 })
  })

  it('1 字も合わなければ、聞き取った区間全体を字数で等分する', () => {
    const times = round(alignTimedText(timed('あいう', 0.2, 1), 'カキ'))
    expect(times).toEqual([
      { char: 'カ', startSec: 1, endSec: 1.3 },
      { char: 'キ', startSec: 1.3, endSec: 1.6 },
    ])
  })

  it('時刻が 1 つも無ければ、全部 0 秒', () => {
    expect(alignTimedText([], 'はい')).toEqual([
      { char: 'は', startSec: 0, endSec: 0 },
      { char: 'い', startSec: 0, endSec: 0 },
    ])
  })
})

describe('charTimesFromSegments', () => {
  /** whisper.cpp などは区間（文くらい）の時刻しか返さない。区間の中を、話す長さの重み（拍・句読点の間）で字に割り振る。 */
  it('区間の中を拍で割り振る（読点は間の長さ、かなは 1 拍）', () => {
    const times = charTimesFromSegments([{ text: 'はい、そう', startSec: 1, endSec: 2 }])

    expect(times.map((t) => t.char)).toEqual(['は', 'い', '、', 'そ', 'う'])
    expect(times[0]?.startSec).toBe(1)
    expect(times.at(-1)?.endSec).toBeCloseTo(2)
    // 読点（0.25 秒相当）は、かな（1/7 秒相当）より長く取る。
    const span = (t: CharTime | undefined) => (t === undefined ? 0 : t.endSec - t.startSec)
    expect(span(times[2])).toBeGreaterThan(span(times[0]))
  })

  it('区間をつなげて返す。空白だけの区間や重みの無い区間は字数で等分する', () => {
    const times = charTimesFromSegments([
      { text: 'あい', startSec: 0, endSec: 1 },
      { text: '!?', startSec: 1, endSec: 1.4 },
    ])
    expect(times.map((t) => [t.char, Math.round(t.startSec * 100) / 100])).toEqual([
      ['あ', 0],
      ['い', 0.5],
      ['!', 1],
      ['?', 1.2],
    ])
  })
})
