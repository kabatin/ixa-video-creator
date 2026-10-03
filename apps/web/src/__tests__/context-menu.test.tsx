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

  /** 取り消せない操作は、押したあとに確認を挟む（インスペクターの「…」と同じ）。 */
  describe('確認が要る項目', () => {
    const openWithConfirm = async (run: () => Promise<void>) => {
      const items: ContextMenuItem[] = [
        { kind: 'item', id: 'd', label: 'キャラクターを削除', disabledReason: null, confirm: 'ミナを削除します。', run },
      ]
      render(
        <ContextMenuHost>
          <Opener items={items} />
        </ContextMenuHost>,
      )
      await openMenu()
      await userEvent.click(screen.getByRole('menuitem', { name: 'キャラクターを削除' }))
    }

    it('押すと確認を出し、「やめる」なら実行しない', async () => {
      const run = vi.fn(() => Promise.resolve())
      await openWithConfirm(run)

      expect(screen.getByText('ミナを削除します。')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
      expect(run).not.toHaveBeenCalled()
    })

    it('確かめて押すと実行する', async () => {
      const run = vi.fn(() => Promise.resolve())
      await openWithConfirm(run)

      await userEvent.click(screen.getByRole('button', { name: 'キャラクターを削除' }))

      expect(run).toHaveBeenCalledTimes(1)
    })

    it('失敗したら理由を出して閉じない', async () => {
      await openWithConfirm(() => Promise.reject(new Error('使われています')))

      await userEvent.click(screen.getByRole('button', { name: 'キャラクターを削除' }))

      expect((await screen.findByRole('alert')).textContent).toContain('使われています')
    })
  })
})


/**
 * 手順を飛ばしたときの確認（制作者 2026-10-03）は、取り消せない操作ではない。確認のボタンを危険色にせず、
 * 「このまま作る」のような言葉にする。
 */
describe('ContextMenuHost.perform の確認の見た目', () => {
  const Performer = ({ item }: { readonly item: Extract<ContextMenuItem, { kind: 'item' }> }) => {
    const host = useContextMenuHost()
    return (
      <button type="button" onClick={() => host.perform(item)}>
        実行
      </button>
    )
  }

  it('confirmTone と confirmLabel を渡すと、その色と言葉の確認ボタンになり、押せば実行する', async () => {
    const run = vi.fn()
    render(
      <ContextMenuHost>
        <Performer
          item={{
            kind: 'item',
            id: 'draw',
            label: '絵を作る',
            disabledReason: null,
            confirm: '絵コンテがまだ空です。',
            confirmTone: 'primary',
            confirmLabel: 'このまま作る',
            run,
          }}
        />
      </ContextMenuHost>,
    )

    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    const go = screen.getByRole('button', { name: 'このまま作る' })
    expect(go.className).not.toContain('bg-danger')
    await userEvent.click(go)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

/**
 * 確かめて答えを返す口（`window.confirm` の置き換え）。押せば true、閉じれば false。
 * 画面全体を止めるブラウザの確認ではなく、ワークベンチの確認の見た目で聞く。
 */
describe('ContextMenuHost.ask', () => {
  const Asker = ({ onAnswer }: { readonly onAnswer: (answer: boolean) => void }) => {
    const host = useContextMenuHost()
    return (
      <button
        type="button"
        onClick={() => {
          void host.ask({ title: '自動レビュー', message: '2 本をレビューしますか？', confirmLabel: 'レビューする', keepLabel: 'あとで' }).then(onAnswer)
        }}
      >
        聞く
      </button>
    )
  }

  it('「する」を押せば true', async () => {
    const onAnswer = vi.fn()
    render(
      <ContextMenuHost>
        <Asker onAnswer={onAnswer} />
      </ContextMenuHost>,
    )
    await userEvent.click(screen.getByRole('button', { name: '聞く' }))
    expect(screen.getByText('2 本をレビューしますか？')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'レビューする' }))
    expect(onAnswer).toHaveBeenCalledWith(true)
  })

  it('「しない」を押せば false', async () => {
    const onAnswer = vi.fn()
    render(
      <ContextMenuHost>
        <Asker onAnswer={onAnswer} />
      </ContextMenuHost>,
    )
    await userEvent.click(screen.getByRole('button', { name: '聞く' }))
    await userEvent.click(screen.getByRole('button', { name: 'あとで' }))
    expect(onAnswer).toHaveBeenCalledWith(false)
  })
})
