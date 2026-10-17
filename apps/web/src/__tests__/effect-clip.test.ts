import { EffectTemplateKey, TimelineClip, defaultEffectParams, effectFieldsOf } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  EFFECT_PICKER_OPTIONS,
  changeEffectParam,
  effectChipLabel,
  formatEffectValue,
  planEffectInsert,
} from '@/lib/effect-clip'

const PROJECT = '01ARZ3NDEKTSV4RRFFQ69G5F99'

const effectClip = (n: number, startSec: number, durationSec: number, layer = 0) =>
  TimelineClip.parse({
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`,
    projectId: PROJECT,
    track: 'VFX',
    startSec,
    durationSec,
    layer,
    content: { type: 'motion_graphics', templateKey: 'flash', params: {} },
    opacity: 1,
    createdAt: new Date(),
  })

/** エフェクト（ADR-0050）の画面の決まり。型・範囲の正は domain。 */
describe('planEffectInsert', () => {
  it('型の既定の尺で置く', () => {
    expect(planEffectInsert({ clips: [], templateKey: 'title_card', atSec: 3, programEndSec: 60 })).toEqual({
      ok: true, startSec: 3, durationSec: 2, layer: 0,
    })
  })

  it('タイムラインの終わりで尺を切り、終わりより後ろは断る', () => {
    expect(planEffectInsert({ clips: [], templateKey: 'title_card', atSec: 59, programEndSec: 60 })).toMatchObject({ ok: true, durationSec: 1 })
    expect(planEffectInsert({ clips: [], templateKey: 'flash', atSec: 60, programEndSec: 60 })).toMatchObject({ ok: false })
  })

  it('重なる相手がいれば空いている上の段へ（断らない）', () => {
    const clips = [effectClip(1, 2.8, 0.5, 0), effectClip(2, 3, 1, 1), effectClip(3, 10, 1, 2)]
    expect(planEffectInsert({ clips, templateKey: 'flash', atSec: 3, programEndSec: 60 })).toMatchObject({ ok: true, layer: 2 })
    expect(planEffectInsert({ clips, templateKey: 'flash', atSec: 5, programEndSec: 60 })).toMatchObject({ ok: true, layer: 0 })
  })
})

describe('画面の言葉', () => {
  it('選ぶ欄は 8 種を日本語で並べる', () => {
    expect(EFFECT_PICKER_OPTIONS.map((o) => o.label).sort()).toEqual(
      ['フラッシュ', '光漏れ', 'スピード線', 'フィルム焼け', 'グリッチ', 'タイトルカード', '揺れ', '寄りのパンチ'].sort(),
    )
  })

  it.each(EffectTemplateKey.options)('%s のつまみの値に px や生の秒を出さない', (key) => {
    effectFieldsOf(key).forEach((field) => {
      if (field.kind !== 'number') return
      const text = formatEffectValue(field, field.defaultValue)
      expect(text).not.toContain('px')
      expect(text).not.toMatch(/^\d+(\.\d+)?$/)
    })
  })

  it('知らない型は内部の鍵を出さずに言う', () => {
    expect(effectChipLabel({ templateKey: 'ink_splash', params: {} })).toBe('知らない種類のエフェクト')
  })

  it('帯の札は型の名前。タイトルカードは文字も', () => {
    expect(effectChipLabel({ templateKey: 'zoom_punch', params: {} })).toBe('寄りのパンチ')
    expect(effectChipLabel({ templateKey: 'title_card', params: { text: '決勝' } })).toBe('タイトル「決勝」')
  })
})

describe('changeEffectParam', () => {
  it('1 項目だけ変え、他は残す', () => {
    const changed = changeEffectParam({ templateKey: 'flash', params: { ...defaultEffectParams('flash'), color: '#000000' } }, 'intensity', 0.4)
    expect(changed).toEqual({ ok: true, params: { ...defaultEffectParams('flash'), color: '#000000', intensity: 0.4 } })
  })

  it('範囲外は通さない（スキーマの範囲を外せばここが落ちる）', () => {
    expect(changeEffectParam({ templateKey: 'zoom_punch', params: {} }, 'scale', 1.5)).toMatchObject({ ok: false })
  })
})
