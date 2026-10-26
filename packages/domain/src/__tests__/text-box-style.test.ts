import { describe, expect, it } from 'vitest'
import { DEFAULT_DIALOGUE_TEXT_STYLE } from '../shot/dialogue-telop-clips.js'
import { DEFAULT_NARRATION_TEXT_STYLE } from '../narration/narration-telop-clips.js'
import {
  DEFAULT_TEXT_MARGIN_Y,
  DEFAULT_TEXT_PADDING_X,
  DEFAULT_TEXT_PADDING_Y,
  MAX_TEXT_MARGIN,
  MAX_TEXT_PADDING,
  TEXT_STYLE_KEY_LABELS,
  TEXT_TEMPLATE_STYLE_DEFAULTS,
  TextStyle,
  resolveTextStyle,
  textStyleChangeSummary,
} from '../timeline/text-style.js'

/**
 * テロップの箱の余白（外側: 画面の端から。内側: 帯の中）。
 * 外側は画面の幅・高さに対する割合、内側は文字の大きさに対する割合（縁取りの太さと同じ）。
 * **省いたら今までと同じ絵**（既定値は今までの数）。
 */
describe('余白の項目の範囲', () => {
  it.each(['marginX', 'marginY'] as const)('%s は 0〜MAX_TEXT_MARGIN', (key) => {
    expect(TextStyle.parse({ [key]: 0 })).toEqual({ [key]: 0 })
    expect(TextStyle.parse({ [key]: MAX_TEXT_MARGIN })).toEqual({ [key]: MAX_TEXT_MARGIN })
    expect(TextStyle.safeParse({ [key]: -0.01 }).success).toBe(false)
    expect(TextStyle.safeParse({ [key]: MAX_TEXT_MARGIN + 0.01 }).success).toBe(false)
    expect(TextStyle.safeParse({ [key]: '0.1' }).success).toBe(false)
    expect(TextStyle.safeParse({ [key]: Number.NaN }).success).toBe(false)
  })

  it.each(['paddingX', 'paddingY'] as const)('%s は 0〜MAX_TEXT_PADDING', (key) => {
    expect(TextStyle.parse({ [key]: 0 })).toEqual({ [key]: 0 })
    expect(TextStyle.parse({ [key]: MAX_TEXT_PADDING })).toEqual({ [key]: MAX_TEXT_PADDING })
    expect(TextStyle.safeParse({ [key]: -0.01 }).success).toBe(false)
    expect(TextStyle.safeParse({ [key]: MAX_TEXT_PADDING + 0.01 }).success).toBe(false)
    expect(TextStyle.safeParse({ [key]: null }).success).toBe(false)
  })

  it('書き間違いの項目は今も弾く（strict のまま）', () => {
    expect(TextStyle.safeParse({ marginBottom: 0.1 }).success).toBe(false)
    expect(TextStyle.safeParse({ padding: 0.1 }).success).toBe(false)
  })

  it('左右の余白は、箱が画面の 2 割より狭くならない上限', () => {
    expect(1 - 2 * MAX_TEXT_MARGIN).toBeCloseTo(0.2, 9)
  })
})

describe('余白の既定値は今までの数', () => {
  it.each(['plain', 'lower_third'] as const)('%s', (template) => {
    expect(TEXT_TEMPLATE_STYLE_DEFAULTS[template]).toMatchObject({
      marginX: null,
      marginY: 0.08,
      paddingX: 0.75,
      paddingY: 0.5,
    })
    expect([DEFAULT_TEXT_MARGIN_Y, DEFAULT_TEXT_PADDING_X, DEFAULT_TEXT_PADDING_Y]).toEqual([0.08, 0.75, 0.5])
  })

  it('当てた値が既定に勝つ', () => {
    expect(resolveTextStyle('plain', { marginX: 0.05, marginY: 0.12, paddingX: 0.3, paddingY: 0.2 })).toMatchObject({
      marginX: 0.05,
      marginY: 0.12,
      paddingX: 0.3,
      paddingY: 0.2,
    })
  })
})

describe('呼び名', () => {
  it('インスペクターの欄と同じ語', () => {
    expect(TEXT_STYLE_KEY_LABELS.marginX).toBe('余白（左右）')
    expect(TEXT_STYLE_KEY_LABELS.marginY).toBe('余白（上下）')
    expect(TEXT_STYLE_KEY_LABELS.paddingX).toBe('内側の余白（左右）')
    expect(TEXT_STYLE_KEY_LABELS.paddingY).toBe('内側の余白（上下）')
  })

  it('まとめて変えたときの一文に出る', () => {
    expect(textStyleChangeSummary(3, { set: ['marginX', 'paddingX'], unset: [] })).toBe(
      'テロップ 3 件の余白（左右）・内側の余白（左右）を変えました',
    )
  })
})

describe('セリフの字幕の既定の見た目', () => {
  it('ナレーションの帯に、左右の余白を狭めた箱を重ねる（9:16 で短いセリフを 1 行に収める）', () => {
    expect(DEFAULT_DIALOGUE_TEXT_STYLE).toEqual({ ...DEFAULT_NARRATION_TEXT_STYLE, marginX: 0.05, paddingX: 0.3 })
    expect(TextStyle.safeParse(DEFAULT_DIALOGUE_TEXT_STYLE).success).toBe(true)
  })

  it('ナレーションの既定は変えない', () => {
    expect(DEFAULT_NARRATION_TEXT_STYLE).toEqual({
      anchor: 'bottom-center',
      weight: 'bold',
      color: '#ffffff',
      background: { color: '#000000', opacity: 0.45 },
    })
  })
})
