import { describe, expect, it } from 'vitest'
import { NARRATION_MORA_PER_SEC, countMora, estimateSpeechSec, narrationCharBudget } from '../narration/speech-estimate.js'

/**
 * 話す長さの見積もり（ADR-0038）。声にする前に「約 2.4 秒」と出し、作品の長さ（15 秒 CM など）に収まるかを見る。
 * 数えるのは読み（かな）の拍。漢字が残っていれば 1 字 2 拍とみなす。
 */

describe('countMora', () => {
  it('かなは 1 字 1 拍。小さい「ゃゅょぁぃぅぇぉ」は前の字と合わせて 1 拍、「っ」「ー」は 1 拍', () => {
    expect(countMora('こんにちは')).toBe(5)
    expect(countMora('きょう')).toBe(2)
    expect(countMora('ちょっと')).toBe(3)
    expect(countMora('ラーメン')).toBe(4)
    expect(countMora('ティー')).toBe(2)
  })

  it('漢字は 1 字 2 拍、数字は 1 字 2 拍、英字は 1 字 1.5 拍とみなす（読みが無い字の見積もり）', () => {
    expect(countMora('戦子')).toBe(4)
    expect(countMora('2026')).toBe(8)
    expect(countMora('CM')).toBe(3)
  })

  it('句読点・記号・空白は拍に数えない', () => {
    expect(countMora('はい、 そう。')).toBe(4)
  })
})

describe('estimateSpeechSec', () => {
  it(`拍を ${NARRATION_MORA_PER_SEC} 拍/秒で割り、読点は 0.25 秒・句点と！？は 0.5 秒の間を足す（0.1 秒に丸める）`, () => {
    expect(estimateSpeechSec('こんにちは', 1)).toBe(0.7)
    expect(estimateSpeechSec('はい。そう', 1)).toBe(1.1)
  })

  it('末尾の句読点は間に数えない（声はそこで終わる。実測で見積もりが長く出ていた）', () => {
    expect(estimateSpeechSec('はい、そう。', 1)).toBe(0.8)
    expect(estimateSpeechSec('行くぞ！」', 1)).toBe(0.6)
  })

  it('速さ 2 なら半分、0.5 なら倍（間は速さで変えない）', () => {
    expect(estimateSpeechSec('あいうえおかきくけこさしすせ', 2)).toBe(1)
    expect(estimateSpeechSec('あいうえおかきくけこさしすせ', 0.5)).toBe(4)
  })

  it('空なら 0 秒', () => {
    expect(estimateSpeechSec('', 1)).toBe(0)
  })
})

describe('narrationCharBudget', () => {
  it('作品の長さに収まる原稿の目安の字数（10 字に丸める。目安なので細かい数は出さない）', () => {
    // 15 秒 × 7 拍/秒 ÷ 1.2 拍/字 ≈ 87.5 字 → 90 字。
    expect(narrationCharBudget(15)).toBe(90)
    expect(narrationCharBudget(60)).toBe(350)
  })

  it('とても短い作品でも 10 字は出す（0 字と言わない）', () => {
    expect(narrationCharBudget(1)).toBe(10)
    expect(narrationCharBudget(0)).toBe(10)
  })
})
