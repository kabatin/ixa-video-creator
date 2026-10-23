import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BulkRemakeFinalForm } from '@/components/bulk-remake-final-form'
import type { RemakeFinalPreview } from '@/components/workbench/use-bulk-actions'

/**
 * まとめて本番で作り直す（ADR-0042）。夜間に自走させるときは「NG なら自動で作り直す」を選べる（ADR-0057）。
 * **既定は選ばない**（レビューと作り直しは時間とトークンを使う）。
 */

const preview: RemakeFinalPreview = {
  kind: 'ready',
  plan: { targetCount: 2, totalLatencySec: 600, skipped: [], estimatedTotalUsd: 0 },
}

describe('BulkRemakeFinalForm', () => {
  it('既定では自動で作り直さずに積む', async () => {
    const onRemake = vi.fn()
    render(<BulkRemakeFinalForm preview={preview} busy={false} onPreview={vi.fn()} onRemake={onRemake} />)
    expect(screen.getByRole('checkbox', { name: /NG なら自動で作り直す/ })).not.toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: '2 本を積む' }))
    expect(onRemake).toHaveBeenCalledWith(false)
  })

  it('選べば、自動で作り直す指定で積む', async () => {
    const onRemake = vi.fn()
    render(<BulkRemakeFinalForm preview={preview} busy={false} onPreview={vi.fn()} onRemake={onRemake} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /NG なら自動で作り直す/ }))
    await userEvent.click(screen.getByRole('button', { name: '2 本を積む' }))
    expect(onRemake).toHaveBeenCalledWith(true)
  })
})
