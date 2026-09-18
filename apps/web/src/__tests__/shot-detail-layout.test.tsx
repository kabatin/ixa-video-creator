import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShotDetailLayout } from '@/components/shot-detail-layout'

/**
 * Shot 詳細の並べ方を固定する（PHASE 6.1）。
 *
 * 守りたいのは 3 つ。
 * 1. **判定するものが先に来る。** DOM の順序がそのまま `lg` 未満の 1 列の順序になるので、
 *    ここが逆になると狭い画面で「設定の欄を通り過ぎてから絵に着く」元の姿に戻る
 * 2. **右の欄が貼り付く。** `lg:sticky` と `lg:items-start` は片方でも欠けると効かない。
 *    見た目は崩れないまま、スクロールすると欄が消えるだけなので気づけない
 * 3. **左が伸び縮みする。** `min-w-0` が無いと Take 一覧（`overflow-x-auto`）が
 *    左の列を押し広げ、右の欄が潰れる
 */

const MAIN_TEXT = '採用中の Take'
const RAIL_TEXT = '生成の設定'

const setup = () => render(<ShotDetailLayout main={<p>{MAIN_TEXT}</p>} rail={<p>{RAIL_TEXT}</p>} />)

const railOf = (container: HTMLElement): HTMLElement => {
  const rail = container.querySelector('aside')
  if (rail === null) throw new Error('右の欄（aside）が無い')
  return rail
}

describe('ShotDetailLayout', () => {
  it('判定するものが操作する欄より前に来る', () => {
    const { container } = setup()

    const main = screen.getByText(MAIN_TEXT)
    const rail = screen.getByText(RAIL_TEXT)
    expect(container.contains(main)).toBe(true)

    // 「前にある」を目で見た位置ではなく DOM の順序で確かめる。
    const order = main.compareDocumentPosition(rail)
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('操作する欄だけが aside に入る', () => {
    const { container } = setup()
    const rail = railOf(container)

    expect(rail).toHaveTextContent(RAIL_TEXT)
    expect(rail).not.toHaveTextContent(MAIN_TEXT)
    expect(rail).toHaveAttribute('aria-label', 'Shot の操作')
  })

  it('広い画面では 2 列になり、狭い画面では縦に積む', () => {
    const { container } = setup()
    const row = container.firstElementChild
    expect(row?.className).toContain('flex-col')
    expect(row?.className).toContain('lg:flex-row')
    // これが無いと右の欄が左の高さまで伸び、sticky が黙って無効になる。
    expect(row?.className).toContain('lg:items-start')
  })

  it('左は伸び縮みし、横幅を食い潰さない', () => {
    setup()
    const main = screen.getByText(MAIN_TEXT).parentElement
    expect(main?.className).toContain('flex-1')
    expect(main?.className).toContain('min-w-0')
  })

  it('右の欄は貼り付き、幅が決まっていて、自分でスクロールする', () => {
    const { container } = setup()
    const rail = railOf(container)

    expect(rail.className).toContain('lg:sticky')
    expect(rail.className).toContain('lg:w-96')
    // 欄が画面より高いとき、これが無いと下端に手が届かない。
    expect(rail.className).toContain('lg:overflow-y-auto')
  })
})
