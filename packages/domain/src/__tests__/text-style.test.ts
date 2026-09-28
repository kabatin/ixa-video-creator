import { describe, expect, it } from 'vitest'
import {
  CreateTextStylePresetInput,
  TEXT_TEMPLATE_STYLE_DEFAULTS,
  TextStyle,
  isTextStyleUnreadable,
  resolveTextStyle,
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
