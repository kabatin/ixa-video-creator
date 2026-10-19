import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryPanel } from '@/components/workbench/panels/history-panel'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import { workbenchValue } from './workbench-fixture'

/**
 * 変更履歴のタブ（レビュー 2026-10-19）。**裏に回っている間は取り直さない。**
 * 作品を読み直すたびに見えないタブが履歴を取りに行っていた。表に出たときに最新にする。
 */

const fake = vi.hoisted(() => ({ listEditBatches: vi.fn(), undoEditBatch: vi.fn() }))
vi.mock('@/lib/edit-history-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/edit-history-api')>()
  return { ...original, createEditHistoryApi: () => fake }
})

describe('変更履歴のタブ', () => {
  it('裏にある間は取らず、表に出たら取り、表にある間は読み直しのたびに取り直す', async () => {
    fake.listEditBatches.mockResolvedValue([])
    const tree = (visible: boolean, serverEpoch: number) => (
      <WorkbenchContext.Provider value={workbenchValue({ serverEpoch })}>
        <HistoryPanel visible={visible} />
      </WorkbenchContext.Provider>
    )
    const view = render(tree(false, 0))
    view.rerender(tree(false, 1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.listEditBatches).not.toHaveBeenCalled()

    view.rerender(tree(true, 1))
    await waitFor(() => {
      expect(fake.listEditBatches).toHaveBeenCalledTimes(1)
    })

    view.rerender(tree(true, 2))
    await waitFor(() => {
      expect(fake.listEditBatches).toHaveBeenCalledTimes(2)
    })

    // 裏に回したあとの読み直しでは取らない。
    view.rerender(tree(false, 3))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.listEditBatches).toHaveBeenCalledTimes(2)
  })
})
