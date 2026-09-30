import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  ContextMenuHost,
  useContextMenuHost,
  type ContextMenuItem,
} from '@/components/workbench/ui/context-menu'

/**
 * 右クリックのメニューの部品。メニューバーと同じ操作（↑↓ Home End Enter Esc）。
 * 押せない項目は理由を添えて実行しない。閉じたら元の物へ焦点を戻す。**キーはワークベンチのショートカットへ漏らさない。**
 */

const Opener = ({ items }: { readonly items: readonly ContextMenuItem[] }) => {
  const host = useContextMenuHost()
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => {
        host.open({ label: 'Shot CUT-01 の操作', items, at: { x: 10, y: 10 }, origin: ref.current })
      }}
    >
      開く
    </button>
  )
}

const setup = (overrides: { onRunA?: () => void; onRunC?: () => void } = {}) => {
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      id: 'a',
      label: 'Take を作る…',
      disabledReason: null,
      run: overrides.onRunA ?? vi.fn(),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      id: 'b',
      label: '採用を外す',
      disabledReason: '採用している Take がありません',
      run: vi.fn(),
    },
    {
      kind: 'item',
      id: 'c',
      label: '削除…',
      shortcut: 'Delete',
      disabledReason: null,
      run: overrides.onRunC ?? vi.fn(),
    },
  ]
  render(
    <ContextMenuHost>
      <Opener items={items} />
    </ContextMenuHost>,
  )
  return { items }
}

const openMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: '開く' }))
  return screen.getByRole('menu', { name: 'Shot CUT-01 の操作' })
}

describe('ContextMenu', () => {
  it('開くと最初の項目に焦点が当たる。押せない項目は理由を添える', async () => {
    setup()
    await openMenu()

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Take を作る/ }))
    expect(screen.getByRole('menuitem', { name: /採用を外す/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText('採用している Take がありません')).toBeInTheDocument()
  })

  it('↓ で次へ（区切り線は飛ばす）、End で最後、Home で最初', async () => {
    setup()
    await openMenu()

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('採用を外す')
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toHaveTextContent('削除…')
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('Take を作る…')
    await userEvent.keyboard('{ArrowUp}{Home}')
    expect(document.activeElement).toHaveTextContent('Take を作る…')
  })

  it('Enter で実行して閉じ、焦点を元の物へ戻す', async () => {
    const onRunA = vi.fn()
    setup({ onRunA })
    await openMenu()

    await userEvent.keyboard('{Enter}')

    expect(onRunA).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '開く' }))
  })

  it('押せない項目は押しても実行せず、開いたまま', async () => {
    setup()
    await openMenu()

    await userEvent.click(screen.getByRole('menuitem', { name: /採用を外す/ }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('Esc で閉じて焦点を戻す。キーはワークベンチへ漏らさない', async () => {
    setup()
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    await openMenu()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '開く' }))
    expect(onWindowKey).not.toHaveBeenCalled()
    window.removeEventListener('keydown', onWindowKey)
  })

  it('外を押すと閉じる', async () => {
    setup()
    await openMenu()

    act(() => {
      fireEvent.pointerDown(document.body)
    })

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
