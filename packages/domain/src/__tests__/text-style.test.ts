import { describe, expect, it } from 'vitest'
import {
  CreateTextStylePresetInput,
  TEXT_TEMPLATE_STYLE_DEFAULTS,
  TextStyle,
  isTextStyleUnreadable,
  mergeTextStyle,
  resolveTextStyle,
  textStyleChangeSummary,
} from '../timeline/text-style.js'
import { parseTextClipParams } from '../timeline/text-template.js'

/**
 * テロップの見た目（ADR-0028）。
 * 型（plain / lower_third）の既定値に、テロップごとの `style` を重ねて最終の見た目を決める。
 */
describe('TextStyle', () => {
  it('すべての項目を持てる（どれも省略できる）', () => {
    const full = {
      font: 'mincho',
      size: 0.06,
      weight: 'heavy',
      color: '#FFD100',
      stroke: { color: '#000000', width: 0.1 },
      shadow: 'strong',
      background: { color: '#000000', opacity: 0.4 },
      align: 'right',
      anchor: 'top-left',
      offset: { x: 0.1, y: -0.05 },
      fadeInSec: 0.5,
      fadeOutSec: 1,
    }
    expect(TextStyle.parse(full)).toEqual(full)
    expect(TextStyle.parse({})).toEqual({})
  })

  it.each([
    ['色の形', { color: 'red' }],
    ['大きさが小さすぎる', { size: 0.01 }],
    ['大きさが大きすぎる', { size: 0.3 }],
    ['ずらしが画面の外', { offset: { x: 0.6, y: 0 } }],
    ['フェードが長すぎる', { fadeInSec: 2.5 }],
    ['縁取りが太すぎる', { stroke: { color: '#000000', width: 0.3 } }],
    ['背景の濃さが範囲外', { background: { color: '#000000', opacity: 1.2 } }],
    ['知らない定位置', { anchor: 'center' }],
    ['知らない項目（書き間違い）', { colour: '#FFFFFF' }],
  ])('%s は弾く', (_label, style) => {
    expect(TextStyle.safeParse(style).success).toBe(false)
  })
})

describe('resolveTextStyle', () => {
  it('style が無ければ型の既定値そのもの（今あるテロップは同じ絵）', () => {
    expect(resolveTextStyle('plain', undefined)).toEqual(TEXT_TEMPLATE_STYLE_DEFAULTS.plain)
    expect(resolveTextStyle('lower_third', {})).toEqual(TEXT_TEMPLATE_STYLE_DEFAULTS.lower_third)
  })

  it('指定した項目だけ上書きする', () => {
    const resolved = resolveTextStyle('lower_third', { color: '#FFD100', anchor: 'top-center' })
    expect(resolved).toEqual({
      ...TEXT_TEMPLATE_STYLE_DEFAULTS.lower_third,
      color: '#FFD100',
      anchor: 'top-center',
    })
  })

  it('null は「無し」として上書きする（下帯の背景を消せる）', () => {
    expect(resolveTextStyle('lower_third', { background: null }).background).toBeNull()
  })

  it('型ごとの既定値は今の見た目と同じ', () => {
    expect(TEXT_TEMPLATE_STYLE_DEFAULTS.plain).toMatchObject({
      anchor: 'middle-center',
      align: 'center',
      color: '#FFFFFF',
      weight: 'bold',
      shadow: 'soft',
      background: null,
      size: null,
    })
    expect(TEXT_TEMPLATE_STYLE_DEFAULTS.lower_third).toMatchObject({
      anchor: 'bottom-center',
      align: 'left',
      shadow: 'none',
      background: { color: '#000000', opacity: 0.55 },
    })
  })
})

describe('テロップの中身（params）', () => {
  it('見た目と、どのスタイルから当てたかを持てる', () => {
    const params = { text: '歌詞', style: { color: '#FFD100' }, styleId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }
    expect(parseTextClipParams(params)).toEqual(params)
  })

  it('見た目が読めなくても、文字は描ける（見た目だけ捨てる）', () => {
    const params = { text: '歌詞', style: { color: 'red' } }
    expect(parseTextClipParams(params)).toEqual({ text: '歌詞' })
    expect(isTextStyleUnreadable(params)).toBe(true)
  })

  it('どのスタイルからか が壊れていても、見た目と文字は残す', () => {
    expect(parseTextClipParams({ text: '歌詞', style: { size: 0.05 }, styleId: 'broken' })).toEqual({
      text: '歌詞',
      style: { size: 0.05 },
    })
  })

  it('見た目が無い・読めるなら、読めないとは言わない', () => {
    expect(isTextStyleUnreadable({ text: '歌詞' })).toBe(false)
    expect(isTextStyleUnreadable({ text: '歌詞', style: { size: 0.05 } })).toBe(false)
  })

  it('文字が読めなければ今までどおり null（見た目があっても）', () => {
    expect(parseTextClipParams({ text: '', style: { color: '#FFFFFF' } })).toBeNull()
  })
})

describe('保存するスタイル', () => {
  it('名前は空にできず、前後の空白は落とす', () => {
    expect(CreateTextStylePresetInput.parse({ name: ' 歌詞 ', style: {} }).name).toBe('歌詞')
    expect(CreateTextStylePresetInput.safeParse({ name: '  ', style: {} }).success).toBe(false)
  })

  it('中身は TextStyle と同じ検査を通す', () => {
    expect(CreateTextStylePresetInput.safeParse({ name: '歌詞', style: { color: 'red' } }).success).toBe(false)
  })
})

/**
 * テロップをまとめて変える（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * **変えた項目だけ**を重ねる。大きさだけ変えれば、色や位置はテロップごとに今のまま。
 */
describe('mergeTextStyle', () => {
  const current: TextStyle = { size: 0.05, color: '#FF0000', anchor: 'top-left', offset: { x: 0.1, y: 0 } }

  it('指定した項目だけを上書きし、ほかの項目は残す', () => {
    expect(mergeTextStyle(current, { size: 0.08 }, [])).toEqual({ ...current, size: 0.08 })
  })

  it('消す項目は型の既定へ戻す（上書きを外す）', () => {
    expect(mergeTextStyle(current, {}, ['color', 'offset'])).toEqual({ size: 0.05, anchor: 'top-left' })
  })

  it('いまの見た目が読めなければ、無しから重ねる', () => {
    expect(mergeTextStyle({ size: 99 }, { anchor: 'bottom-center' }, [])).toEqual({ anchor: 'bottom-center' })
  })

  it('範囲の外の値は弾く', () => {
    expect(() => mergeTextStyle(current, { size: 0.9 }, [])).toThrow()
  })

  it('元の見た目を書き換えない', () => {
    const before = structuredClone(current)
    mergeTextStyle(current, { size: 0.08 }, ['color'])
    expect(current).toEqual(before)
  })
})

/** まとめて変えたことの一文。画面の知らせと変更の履歴の見出しで同じ文にする。 */
describe('textStyleChangeSummary', () => {
  it('変えた項目を決まった並びで言う（上書きも外すも「変えた」）', () => {
    expect(textStyleChangeSummary(58, { set: ['anchor', 'size'], unset: ['font'] })).toBe(
      'テロップ 58 件の書体・大きさ・位置を変えました',
    )
  })

  it('丸ごと当てたら「見た目を当てました」、全部外しただけなら「型の既定に戻しました」', () => {
    expect(textStyleChangeSummary(3, null)).toBe('テロップ 3 件に見た目を当てました')
    expect(
      textStyleChangeSummary(3, {
        set: [],
        unset: ['font', 'size', 'weight', 'color', 'stroke', 'shadow', 'background', 'align', 'anchor', 'offset', 'fadeInSec', 'fadeOutSec'],
      }),
    ).toBe('テロップ 3 件の見た目を型の既定に戻しました')
  })
})
