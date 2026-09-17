import { describe, expect, it } from 'vitest'
import {
  INLINE_PANEL_MARGIN_PX,
  clampInlinePanelPosition,
  describeInlineFormKeys,
  inlineFormErrors,
  resolveInlineFormKey,
} from '@/lib/timeline-inline-form'

/**
 * その場に出る入力の**判定だけ**を確かめる。描画は起こさない（node 環境）。
 * 見た目のテストは `timeline-inline-form.test.tsx` にある。
 */

describe('resolveInlineFormKey — 打鍵の行き先', () => {
  const event = (
    key: string,
    over: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; tagName: string }> = {},
  ) => ({
    key,
    shiftKey: over.shiftKey ?? false,
    ctrlKey: over.ctrlKey ?? false,
    metaKey: over.metaKey ?? false,
    target: over.tagName === undefined ? null : { tagName: over.tagName },
  })

  it('Escape は閉じる', () => {
    expect(resolveInlineFormKey(event('Escape'))).toBe('dismiss')
  })

  it('Enter は送る', () => {
    expect(resolveInlineFormKey(event('Enter', { tagName: 'INPUT' }))).toBe('submit')
  })

  it('ボタンの上の Enter は送らない', () => {
    expect(resolveInlineFormKey(event('Enter', { tagName: 'BUTTON' }))).toBe('contain')
  })

  it('修飾キー付きの Enter は送らない（変換確定などを奪わない）', () => {
    expect(resolveInlineFormKey(event('Enter', { metaKey: true }))).toBe('contain')
    expect(resolveInlineFormKey(event('Enter', { shiftKey: true }))).toBe('contain')
  })

  it('当てはまらない打鍵は受け止める。null を返さない', () => {
    expect(resolveInlineFormKey(event('s'))).toBe('contain')
    expect(resolveInlineFormKey(event('ArrowLeft'))).toBe('contain')
  })

  it('画面に出す一覧は実際の判定から作る', () => {
    const help = describeInlineFormKeys()

    expect(help).toEqual([
      { keys: 'Enter', action: '送る' },
      { keys: 'Escape', action: '閉じる' },
    ])
  })
})

describe('inlineFormErrors — 指摘を畳んでも捨てない', () => {
  it('欄の指摘はその欄へ', () => {
    const errors = inlineFormErrors([
      { field: 'text', message: '文字を入れてください' },
      { field: 'durationSec', message: '尺は 0 より大きい必要があります' },
    ])

    expect(errors).toEqual({
      fields: { text: '文字を入れてください', durationSec: '尺は 0 より大きい必要があります' },
    })
  })

  it('知らない欄名の指摘を捨てない。まとめて form へ出す', () => {
    const errors = inlineFormErrors([
      { field: 'layer', message: '重なっています' },
      { field: 'atSec', message: '置ける隙間がありません' },
    ])

    expect(errors.fields).toBeUndefined()
    expect(errors.form).toContain('重なっています')
    expect(errors.form).toContain('置ける隙間がありません')
  })

  it('同じ欄に 2 つあれば先頭を出す', () => {
    const errors = inlineFormErrors([
      { field: 'type', message: '先の指摘' },
      { field: 'type', message: '後の指摘' },
    ])

    expect(errors.fields?.type).toBe('先の指摘')
  })

  it('指摘が無ければ空。何も出さない', () => {
    expect(inlineFormErrors([])).toEqual({})
  })
})

describe('clampInlinePanelPosition — 画面の端で切れない', () => {
  const panel = { widthPx: 260, heightPx: 200 }
  const container = { widthPx: 1000, heightPx: 400 }
  const margin = INLINE_PANEL_MARGIN_PX

  it('余裕があれば点を中心に置く', () => {
    const placement = clampInlinePanelPosition({ leftPx: 500, topPx: 40 }, panel, container)

    expect(placement.leftPx).toBe(500 - panel.widthPx / 2)
    expect(placement.placedAbove).toBe(false)
  })

  it('右端では右へはみ出さない', () => {
    const placement = clampInlinePanelPosition({ leftPx: 995, topPx: 40 }, panel, container)

    expect(placement.leftPx + panel.widthPx).toBeLessThanOrEqual(container.widthPx - margin)
  })

  it('左端では左へはみ出さない', () => {
    const placement = clampInlinePanelPosition({ leftPx: 2, topPx: 40 }, panel, container)

    expect(placement.leftPx).toBe(margin)
  })

  it('下に入らず上が広ければ上へ返す', () => {
    const placement = clampInlinePanelPosition({ leftPx: 500, topPx: 380 }, panel, container)

    expect(placement.placedAbove).toBe(true)
    expect(placement.topPx).toBeLessThan(380)
    expect(placement.topPx).toBeGreaterThanOrEqual(margin)
  })

  it('器より大きくても縁に寄せる。負の座標へ飛ばさない', () => {
    const placement = clampInlinePanelPosition({ leftPx: 20, topPx: 20 }, panel, {
      widthPx: 120,
      heightPx: 90,
    })

    expect(placement.leftPx).toBe(margin)
    expect(placement.topPx).toBe(margin)
  })
})
