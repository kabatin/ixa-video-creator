import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'

/**
 * ダイアログの殻（UI-WORKBENCH §3.3 / §10）。
 * 開くと焦点が中に入る・Esc で閉じる・未保存の入力があると背景クリックで閉じない・
 * 閉じたら焦点が開き口へ戻る。
 */

beforeAll(() => {
  // jsdom の <dialog> は showModal の焦点送りを持たないので、ブラウザと同じく最初の押せるものへ送る。
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
    this.querySelector<HTMLElement>('button, input, [tabindex]')?.focus()
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

const Harness = ({ guardUnsaved = false }: { readonly guardUnsaved?: boolean }) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        開く
      </button>
      <WorkbenchDialog
        open={open}
        title="書き出し"
        guardUnsaved={guardUnsaved}
        onClose={() => {
          setOpen(false)
        }}
      >
        <input aria-label="名前" />
      </WorkbenchDialog>
    </>
  )
}

const dialog = (): HTMLElement => document.querySelector('dialog') as HTMLElement

describe('WorkbenchDialog', () => {
  it('開くと焦点が中に入る', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '開く' })
    opener.focus()
    fireEvent.click(opener)
    expect(dialog()).toHaveAttribute('open')
    expect(dialog().contains(document.activeElement)).toBe(true)
  })

  it('Esc（cancel）で閉じ、焦点が開き口へ戻る', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '開く' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent(dialog(), new Event('cancel', { cancelable: true }))
    expect(dialog()).not.toHaveAttribute('open')
    expect(document.activeElement).toBe(opener)
  })

  it('閉じるボタンで閉じる', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.click(screen.getByRole('button', { name: '書き出しを閉じる' }))
    expect(dialog()).not.toHaveAttribute('open')
  })

  it('背景クリックで閉じる', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.click(dialog())
    expect(dialog()).not.toHaveAttribute('open')
  })

  it('中身のクリックでは閉じない', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.click(screen.getByLabelText('名前'))
    expect(dialog()).toHaveAttribute('open')
  })

  it('未保存の入力があると背景クリックで閉じない（Esc は効く）', () => {
    render(<Harness guardUnsaved />)
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.input(screen.getByLabelText('名前'), { target: { value: '書きかけ' } })
    fireEvent.click(dialog())
    expect(dialog()).toHaveAttribute('open')
    expect(screen.getByText('保存していない入力があります')).toBeInTheDocument()
    fireEvent(dialog(), new Event('cancel', { cancelable: true }))
    expect(dialog()).not.toHaveAttribute('open')
  })

  it('守らない設定なら、入力があっても背景クリックで閉じる', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    fireEvent.input(screen.getByLabelText('名前'), { target: { value: 'x' } })
    fireEvent.click(dialog())
    expect(dialog()).not.toHaveAttribute('open')
  })

  it('題名で名前が付く（aria-labelledby）', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    expect(screen.getByRole('dialog', { name: '書き出し' })).toBeInTheDocument()
  })
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
