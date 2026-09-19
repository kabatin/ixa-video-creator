import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'

/** 確定したら保存する欄（UI-WORKBENCH-2 P4）。保存ボタンを置かない。 */

const setup = (onSave = vi.fn().mockResolvedValue(undefined), validate?: (next: string) => string | null) => {
  render(<AutoSaveField label="名前" value="元" onSave={onSave} validate={validate} />)
  return { input: screen.getByLabelText('名前'), onSave }
}

describe('AutoSaveField', () => {
  it('欄を離れたら保存し、✓ を出す', async () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: '新' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('新')
    await waitFor(() => {
      expect(screen.getByText('✓ 保存しました')).toBeInTheDocument()
    })
  })

  it('Enter でも保存する', () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: '新' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('新')
  })

  it('変わっていなければ送らない', () => {
    const { input, onSave } = setup()
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Esc で打ちかけを捨てる', () => {
    const { input, onSave } = setup()
    fireEvent.change(input, { target: { value: '新' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('元')
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('検証に落ちたら送らず理由を出す', () => {
    const { input, onSave } = setup(undefined, () => '空にできません')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('空にできません')
  })

  it('保存に失敗したら理由を出す（黙って戻さない）', async () => {
    const { input } = setup(vi.fn().mockRejectedValue(new Error('500')))
    fireEvent.change(input, { target: { value: '新' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした: 500')
    })
  })

  it('↺ で直前の値へ戻す', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<AutoSaveField label="名前" value="元" onSave={onSave} />)
    const input = screen.getByLabelText('名前')
    fireEvent.change(input, { target: { value: '新' } })
    fireEvent.blur(input)
    const revert = await screen.findByRole('button', { name: '↺ 戻す' })
    // 保存が通ると、親は新しい値を渡し直す。
    rerender(<AutoSaveField label="名前" value="新" onSave={onSave} />)
    await act(async () => {
      revert.click()
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenLastCalledWith('元')
  })
})
