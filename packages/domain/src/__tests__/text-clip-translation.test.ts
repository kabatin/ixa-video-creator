import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSLATION_SCALE,
  MAX_TRANSLATION_SCALE,
  MIN_TRANSLATION_SCALE,
  TEXT_STYLE_KEY_LABELS,
  TEXT_TEMPLATE_STYLE_DEFAULTS,
  TextStyle,
  resolveTextStyle,
} from '../timeline/text-style.js'
import { MAX_TEXT_CLIP_TRANSLATION_LENGTH, TextClipParams, parseTextClipParams } from '../timeline/text-template.js'

/**
 * 2 段字幕（ADR-0061）。テロップの下の段に訳文を小さめに出す。
 * 訳文は `params.translation`、下の段の大きさは見た目の `translationScale`（上の段に対する割合）。
 */
describe('下の段の大きさ（translationScale）', () => {
  it('既定は上の段の 0.6 倍。どちらの型でも同じ', () => {
    expect(DEFAULT_TRANSLATION_SCALE).toBe(0.6)
    expect(TEXT_TEMPLATE_STYLE_DEFAULTS.plain.translationScale).toBe(0.6)
    expect(TEXT_TEMPLATE_STYLE_DEFAULTS.lower_third.translationScale).toBe(0.6)
    expect(resolveTextStyle('plain', { translationScale: 0.8 }).translationScale).toBe(0.8)
  })

  it('範囲の中は持てる', () => {
    expect(TextStyle.parse({ translationScale: MIN_TRANSLATION_SCALE })).toEqual({ translationScale: MIN_TRANSLATION_SCALE })
    expect(TextStyle.parse({ translationScale: MAX_TRANSLATION_SCALE })).toEqual({ translationScale: MAX_TRANSLATION_SCALE })
  })

  it.each([
    ['小さすぎる（読めない）', MIN_TRANSLATION_SCALE - 0.01],
    ['上の段より大きい', MAX_TRANSLATION_SCALE + 0.01],
    ['数でない', '0.6'],
  ])('%s は弾く', (_label, translationScale) => {
    expect(TextStyle.safeParse({ translationScale }).success).toBe(false)
  })

  it('呼び名は画面の欄と同じ「2 段目の大きさ」（変更の履歴とインスペクターで言葉をそろえる）', () => {
    expect(TEXT_STYLE_KEY_LABELS.translationScale).toBe('2 段目の大きさ')
  })

  it('見た目は今も知らない項目を弾く（strict のまま）', () => {
    expect(TextStyle.safeParse({ translationSize: 0.6 }).success).toBe(false)
  })
})

describe('訳文（params.translation）', () => {
  it('訳文を持てて、読み出しでも残る', () => {
    const params = { text: 'ねえ、ネズミくん。', translation: 'Hey, little mouse.' }
    expect(TextClipParams.parse(params)).toEqual(params)
    expect(parseTextClipParams(params)).toEqual(params)
  })

  it('訳文の無いテロップは今までと同じ形で読める（translation の鍵を足さない）', () => {
    expect(parseTextClipParams({ text: '歌詞' })).toEqual({ text: '歌詞' })
  })

  it.each([
    ['空', ''],
    ['空白だけ', '   '],
    ['長すぎる', 'a'.repeat(MAX_TEXT_CLIP_TRANSLATION_LENGTH + 1)],
    ['文字でない', 3],
  ])('%s の訳文は保存の形で弾く', (_label, translation) => {
    expect(TextClipParams.safeParse({ text: '本文', translation }).success).toBe(false)
  })

  it('上限ちょうどの訳文は持てる', () => {
    const translation = 'a'.repeat(MAX_TEXT_CLIP_TRANSLATION_LENGTH)
    expect(TextClipParams.safeParse({ text: '本文', translation }).success).toBe(true)
  })

  it('読めない訳文は捨て、本文は残す（壊れた訳文で本文まで消さない）', () => {
    expect(parseTextClipParams({ text: '本文', translation: 42 })).toEqual({ text: '本文' })
    expect(parseTextClipParams({ text: '本文', translation: '' })).toEqual({ text: '本文' })
  })
})
