import { EditBatchId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchMenu } from '@/components/workbench/workbench-menu'
import type { UndoState } from '@/components/workbench/use-edit-history'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

/**
 * ⌘Z とメニューの「元に戻す」は確認を出すだけで、戻すのは確認の「戻す」（`runUndo`）の 1 か所。
 * そこで戻したら、サーバの材料と**素材の一覧も読み直す**（`reloadAll`）。
 * 読み直さないと、テキストスタイル（`textStylesEpoch`）・楽曲・キャラクターなどが古いまま残る。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const pendingUndo = (confirm: UndoState['confirm']): UndoState => ({
  availability: { state: 'ready', target: null },
  pending: {
    id: EditBatchId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0'),
    summary: 'テキストスタイル「見出し」を消しました',
    countLabel: '1 件のテキストスタイル',
    when: '10:00',
    createdAt: new Date().toISOString(),
  },
  confirm,
  cancel: vi.fn(),
})

describe('確認の「戻す」', () => {
  it('戻したら、作品を読み直し、素材の一覧（テキストスタイルを含む）も読み直す', async () => {
    const reloadAll = vi.fn().mockResolvedValue(undefined)
    const confirm = vi
      .fn()
      .mockResolvedValue({ level: 'info', text: '「テキストスタイル「見出し」を消しました」を戻しました。' })
    const onNotice = vi.fn()
    const { value } = renderInWorkbench(
      <WorkbenchMenu
        canUndo={pendingUndo(confirm)}
        onUndo={vi.fn()}
        onResetLayout={vi.fn()}
        onNotice={onNotice}
        dock={{ current: null }}
        dockEpoch={0}
        onImportFiles={vi.fn()}
      />,
      {},
      { actions: { ...assetStoreValue().actions, reloadAll } },
    )

    await userEvent.click(screen.getByRole('button', { name: '戻す' }))

    await waitFor(() => {
      expect(reloadAll).toHaveBeenCalledTimes(1)
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(value.refresh).toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith('「テキストスタイル「見出し」を消しました」を戻しました。', 'info')
  })

  it('戻せなかったら、知らせをエラーとして出す（コンソールで「情報」に混ぜない）', async () => {
    const confirm = vi.fn().mockResolvedValue({ level: 'error', text: '戻せませんでした: 通信できません' })
    const onNotice = vi.fn()
    renderInWorkbench(
      <WorkbenchMenu
        canUndo={pendingUndo(confirm)}
        onUndo={vi.fn()}
        onResetLayout={vi.fn()}
        onNotice={onNotice}
        dock={{ current: null }}
        dockEpoch={0}
        onImportFiles={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '戻す' }))

    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith('戻せませんでした: 通信できません', 'error')
    })
  })
})
