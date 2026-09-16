import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmButton } from '@/components/ui/confirm-button'

/**
 * 取り消せない操作が 1 クリックで実行されないことを、実際に押して確かめる。
 * 実装を読んで確かめるのでは、あとで分岐が変わったときに気づけない。
 */
describe('ConfirmButton', () => {
  const setup = () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmButton
        label="削除"
        message="Look「ステージ衣装」を削除します。元に戻せません。"
        onConfirm={onConfirm}
      />,
    )
    return { onConfirm, user: userEvent.setup() }
  }

  it('1 回押しただけでは実行しない', async () => {
    const { onConfirm, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('押すと、何が消えるかと戻せないことを出す', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '削除' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('ステージ衣装')
    expect(dialog).toHaveTextContent('元に戻せません')
  })

  it('2 回目を押して初めて実行する', async () => {
    const { onConfirm, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('やめると実行しない。確認も閉じる', async () => {
    const { onConfirm, user } = setup()

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('無効なときは確認にも進まない', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="削除" message="消えます" disabled onConfirm={onConfirm} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
