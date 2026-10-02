import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'

/**
 * 欄の「✦ AI」（ADR-0032 の 3 段目。制作者 2026-09-30「入力を LLM で補助」）。
 * 案を出すだけで、**「使う」を押すまで欄は変わらない。** 使ったらいつもどおり保存し、↺ で戻せる。
 */

const renderField = (request: (current: string, instruction: string | null) => Promise<string>) => {
  const onSave = vi.fn(() => Promise.resolve())
  render(<AutoSaveField label="説明" multiline value="屋上で振り返る" onSave={onSave} assist={request} />)
  return { onSave }
}

describe('AutoSaveField の「✦ AI」', () => {
  it('注文を添えて案を出し、「使う」で欄に入れて保存する（↺ で戻せる）', async () => {
    const request = vi.fn(() => Promise.resolve('青い外光の屋上で、ゆっくり振り返る'))
    const { onSave } = renderField(request)

    await userEvent.click(screen.getByRole('button', { name: '説明 の案を AI に出してもらう' }))
    await userEvent.type(screen.getByLabelText('AI への注文（任意）'), 'もっと静かに')
    await userEvent.click(screen.getByRole('button', { name: '案を出す' }))

    expect(await screen.findByText('青い外光の屋上で、ゆっくり振り返る')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('屋上で振り返る', 'もっと静かに')
    expect(onSave).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '使う' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('青い外光の屋上で、ゆっくり振り返る')
    })
    expect(screen.getByRole('button', { name: '↺ 戻す' })).toBeTruthy()
  })

  it('「やめる」なら欄は変わらない', async () => {
    const { onSave } = renderField(() => Promise.resolve('案'))

    await userEvent.click(screen.getByRole('button', { name: '説明 の案を AI に出してもらう' }))
    await userEvent.click(screen.getByRole('button', { name: '案を出す' }))
    await screen.findByText('案')
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByText('案')).toBeNull()
  })

  it('出せなかったら理由を出す', async () => {
    renderField(() => Promise.reject(new Error('Grok にサインインしていません')))

    await userEvent.click(screen.getByRole('button', { name: '説明 の案を AI に出してもらう' }))
    await userEvent.click(screen.getByRole('button', { name: '案を出す' }))

    expect(await screen.findByText(/Grok にサインインしていません/)).toBeTruthy()
  })

  it('口を渡さなければ「✦ AI」を出さない', () => {
    render(<AutoSaveField label="コード" value="CUT-01" onSave={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /AI に出してもらう/ })).toBeNull()
  })
})
