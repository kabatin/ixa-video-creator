import { describe, expect, it } from 'vitest'
import { effectFieldsOf } from '../timeline/effect-fields.js'
import {
  EFFECT_TEMPLATES,
  EffectTemplateKey,
  MAX_TITLE_CARD_LENGTH,
  defaultEffectParams,
  parseEffectParams,
} from '../timeline/effect-template.js'

/** エフェクトの型（ADR-0050）。保存・描画・画面・エージェントが同じスキーマを通す。 */
describe('EFFECT_TEMPLATES', () => {
  it('enum の鍵を 1 つずつ持つ', () => {
    expect(EFFECT_TEMPLATES.map((t) => t.key).sort()).toEqual([...EffectTemplateKey.options].sort())
  })

  it('揺れと寄りのパンチだけが下の絵を動かす（frame）', () => {
    expect(EFFECT_TEMPLATES.filter((t) => t.kind === 'frame').map((t) => t.key).sort()).toEqual(['shake', 'zoom_punch'])
  })

  it.each(EffectTemplateKey.options)('%s は空の値から既定値で作れる', (key) => {
    const parsed = parseEffectParams(key, {})
    expect(parsed.ok).toBe(true)
    // 既定値をもう一度通しても同じ（保存した値を読み直せる）。
    expect(parseEffectParams(key, defaultEffectParams(key))).toEqual(parsed)
  })

  it('params が無くても既定値で作れる', () => {
    expect(parseEffectParams('flash', undefined).ok).toBe(true)
  })
})

describe('parseEffectParams の拒否', () => {
  it('知らない型は失敗する', () => {
    expect(parseEffectParams('ink_splash', {})).toMatchObject({ ok: false, field: 'templateKey' })
  })

  it('知らない項目は失敗する（綴り違いが黙って既定値にならない）', () => {
    expect(parseEffectParams('flash', { intensty: 0.5 })).toMatchObject({ ok: false, field: 'intensty' })
  })

  /** 範囲のすぐ外の値。範囲を緩めたら、ここが落ちる。 */
  it.each([
    ['flash', { intensity: 1.01 }, 'intensity'],
    ['flash', { intensity: -0.01 }, 'intensity'],
    ['flash', { attackSec: 1.01 }, 'attackSec'],
    ['flash', { decaySec: 0.04 }, 'decaySec'],
    ['flash', { color: 'white' }, 'color'],
    ['light_leak', { hue: 361 }, 'hue'],
    ['speed_lines', { density: 1.5 }, 'density'],
    ['speed_lines', { direction: 'vertical' }, 'direction'],
    ['film_burn', { intensity: 2 }, 'intensity'],
    ['glitch', { rgbSplit: 1.2 }, 'rgbSplit'],
    ['title_card', { text: 'あ'.repeat(MAX_TITLE_CARD_LENGTH + 1) }, 'text'],
    ['title_card', { text: '   ' }, 'text'],
    ['title_card', { style: 'comic' }, 'style'],
    ['shake', { intensity: 1.1 }, 'intensity'],
    ['shake', { frequencyHz: 31 }, 'frequencyHz'],
    ['shake', { frequencyHz: 0.5 }, 'frequencyHz'],
    ['zoom_punch', { scale: 1.41 }, 'scale'],
    ['zoom_punch', { scale: 1.01 }, 'scale'],
    ['zoom_punch', { peakAtSec: 5.1 }, 'peakAtSec'],
    ['zoom_punch', { decaySec: 'slow' }, 'decaySec'],
  ] as const)('%s %j は %s で失敗する', (key, params, field) => {
    const parsed = parseEffectParams(key, params)
    expect(parsed).toMatchObject({ ok: false, field })
    if (!parsed.ok) expect(parsed.message).toMatch(/[ぁ-んァ-ヶ一-龠]/)
  })

  it('範囲の端の値は通る', () => {
    expect(parseEffectParams('zoom_punch', { scale: 1.4, peakAtSec: 5 }).ok).toBe(true)
    expect(parseEffectParams('zoom_punch', { scale: 1.02 }).ok).toBe(true)
    expect(parseEffectParams('flash', { intensity: 0, color: '#FF00aa' }).ok).toBe(true)
  })

  it('タイトルの前後の空白は落として保存する', () => {
    const parsed = parseEffectParams('title_card', { text: '  iXA CUP  ' })
    expect(parsed.ok && parsed.value.templateKey === 'title_card' && parsed.value.params.text).toBe('iXA CUP')
  })
})

describe('effectFieldsOf', () => {
  it.each(EffectTemplateKey.options)('%s の項目はスキーマの項目と同じ', (key) => {
    expect(effectFieldsOf(key).map((f) => f.key).sort()).toEqual(Object.keys(defaultEffectParams(key)).sort())
  })

  it('範囲と既定値はスキーマから読む', () => {
    expect(effectFieldsOf('zoom_punch').find((f) => f.key === 'scale')).toEqual({
      kind: 'number', key: 'scale', label: '寄る大きさ', unit: 'scale', min: 1.02, max: 1.4, defaultValue: 1.15,
    })
  })

  it('タイトルは文字数の上限を持ち、向きは画面の言葉の選択肢になる', () => {
    expect(effectFieldsOf('title_card').find((f) => f.key === 'text')).toMatchObject({ kind: 'text', maxLength: MAX_TITLE_CARD_LENGTH })
    expect(effectFieldsOf('speed_lines').find((f) => f.key === 'direction')).toMatchObject({
      kind: 'choice',
      options: [{ value: 'radial', label: '中心から' }, { value: 'horizontal', label: '横に流れる' }],
    })
  })
})
