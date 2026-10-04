import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MenuBar } from '@/components/workbench/menu-bar'
import { APP_NAME } from '@/lib/app-name'
import { buildMenus, type MenuItem } from '@/lib/menu-model'

/** メニューバー（UI-WORKBENCH §4 / §10）。← → ↑ ↓ Esc の操作と aria-expanded。 */

const menus = buildMenus({ hasCurrentShot: false, checkedCount: 0, canUndo: false, currentHasTake: false, splitBlocker: null, mergeBlocker: null })

const top = (label: string): HTMLElement => screen.getByRole('menuitem', { name: label })

describe('MenuBar', () => {
  it('見出しは Tab で 1 つだけ止まる（roving tabindex）', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} />)
    const tabbable = screen
      .getAllByRole('menuitem')
      .filter((element) => element.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveTextContent(APP_NAME)
  })

  it('↓ で開いて先頭の項目へ、aria-expanded が立つ', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} />)
    const file = top('ファイル')
    file.focus()
    fireEvent.keyDown(file, { key: 'ArrowDown' })
    expect(file).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'ファイル' })).toBeInTheDocument()
    expect(document.activeElement).toHaveTextContent('新規プロジェクト')
  })

  it('↑ ↓ で項目を移り、端では回り込む', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} />)
    fireEvent.keyDown(top('ファイル'), { key: 'ArrowDown' })
    const first = document.activeElement as HTMLElement
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('プロジェクトを複製…')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' })
    expect(document.activeElement).toHaveTextContent('書き出し…')
  })

  it('← → で隣のメニューへ（開いていれば隣を開く）', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} />)
    fireEvent.keyDown(top('ファイル'), { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(top('編集')).toHaveAttribute('aria-expanded', 'true')
    expect(top('ファイル')).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toHaveTextContent('元に戻す')
  })

  it('閉じている間の ← → は見出しの間を動くだけ', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} />)
    top(APP_NAME).focus()
    fireEvent.keyDown(top(APP_NAME), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(top('ヘルプ'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Esc で閉じて見出しへ戻る', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} />)
    fireEvent.keyDown(top('編集'), { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(top('編集')).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(top('編集'))
  })

  it('Enter で実行し、閉じる', () => {
    const onSelect = vi.fn<(item: MenuItem) => void>()
    render(<MenuBar menus={menus} onSelect={onSelect} />)
    fireEvent.keyDown(top('ファイル'), { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-duplicate' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('無効な項目は焦点は当たるが実行しない（押せない理由を持つ）', () => {
    const onSelect = vi.fn()
    render(<MenuBar menus={menus} onSelect={onSelect} />)
    fireEvent.click(top('編集'))
    const redo = screen.getByRole('menuitem', { name: /やり直す/ })
    expect(redo).toHaveAttribute('aria-disabled', 'true')
    expect(redo).toHaveAttribute('title')
    fireEvent.click(redo)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('メニューの中の打鍵を外へ流さない（Space で再生しない）', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <MenuBar menus={menus} onSelect={vi.fn()} />
      </div>,
    )
    fireEvent.keyDown(top('ファイル'), { key: 'ArrowDown' })
    outer.mockClear()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: ' ' })
    expect(outer).not.toHaveBeenCalled()
  })
})

/**
 * 開いているプロジェクトの名前をヘッダーに出す（制作者の指摘 2026-09-26）。
 * 以前はワークベンチのどこにも名前が無く、複数のプロジェクトを行き来すると
 * いまどれを触っているのか画面から分からなかった。
 */
describe('MenuBar のプロジェクト名', () => {
  it('渡された名前を出す', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} title="LUNA BREW 30秒CM" />)

    expect(screen.getByText('LUNA BREW 30秒CM')).toBeTruthy()
  })

  it('切れて見えても全体を読めるよう、ツールチップにも同じ名前を置く', () => {
    render(<MenuBar menus={menus} onSelect={vi.fn()} title="とても長いプロジェクト名" />)

    expect(screen.getByText('とても長いプロジェクト名').getAttribute('title')).toBe('とても長いプロジェクト名')
  })
})
