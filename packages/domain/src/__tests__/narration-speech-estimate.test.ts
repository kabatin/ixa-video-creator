import { describe, expect, it } from 'vitest'
import { NARRATION_MORA_PER_SEC, countMora, estimateSpeechSec } from '../narration/speech-estimate.js'

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
    expect(estimateSpeechSec('はい、そう。', 1)).toBe(1.3)
  })

  it('速さ 2 なら半分、0.5 なら倍（間は速さで変えない）', () => {
    expect(estimateSpeechSec('あいうえおかきくけこさしすせ', 2)).toBe(1)
    expect(estimateSpeechSec('あいうえおかきくけこさしすせ', 0.5)).toBe(4)
  })

  it('空なら 0 秒', () => {
    expect(estimateSpeechSec('', 1)).toBe(0)
  })
})
