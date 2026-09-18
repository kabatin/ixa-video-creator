import {
  EditBatchId as EditBatchIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  newId,
} from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EditHistoryPanel } from '@/components/edit-history-panel'
import {
  buildEditHistoryView,
  buildUndoResultView,
  formatEditBatchTime,
} from '@/lib/edit-history'
import type {
  EditHistoryApi,
  WireEditBatch,
  WireUndoResult,
} from '@/lib/edit-history-api'

/**
 * 変更の履歴と取り消し（P64-1）。見たいのは 3 点。
 * 1. **取り消し済みの行を消さない**（消すと「取り消した」という事実が失われる）
 * 2. 取り消せない行に「元に戻す」を出さない
 * 3. **戻せなかったものが件数に畳まれず、理由ごと出る**（lessons L-015）
 */

const projectId = newId(ProjectIdSchema)
const shotA = newId(ShotIdSchema)
const shotB = newId(ShotIdSchema)

const aBatch = (overrides: Partial<WireEditBatch> = {}): WireEditBatch => ({
  id: newId(EditBatchIdSchema),
  kind: 'rough_cut',
  summary: '粗編集を 49 件の Shot へ適用しました',
  shotCount: 49,
  undoneAt: null,
  createdAt: '2026-09-18T01:00:00.000Z',
  canUndo: true,
  ...overrides,
})

type Spy = EditHistoryApi & {
  readonly undoCalls: () => readonly string[]
}

const spyApi = (
  batches: readonly WireEditBatch[],
  result?: WireUndoResult,
): Spy => {
  const undoCalls: string[] = []
  const first = batches[0]
  return {
    undoCalls: () => undoCalls,
    listEditBatches: vi.fn(() => Promise.resolve([...batches])),
    undoEditBatch: vi.fn((_projectId, id: string) => {
      undoCalls.push(id)
      return Promise.resolve(
        result ?? {
          batch: { ...(first as WireEditBatch), undoneAt: '2026-09-18T02:00:00.000Z', canUndo: false },
          restored: [shotA],
          failed: [],
        },
      )
    }),
  }
}

describe('EditHistoryPanel', () => {
  it('履歴を並べ、まだ戻していないものに「元に戻す」を出す', async () => {
    const api = spyApi([aBatch()])
    render(<EditHistoryPanel projectId={projectId} api={api} />)

    expect(await screen.findByText('粗編集を 49 件の Shot へ適用しました')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '元に戻す' })).toBeInTheDocument()
  })

  it('**取り消し済みの行を消さない。** その旨を出し、「元に戻す」は出さない', async () => {
    const api = spyApi([
      aBatch({
        summary: '絵コンテの案を 27 件採用しました',
        kind: 'draft_adopt',
        undoneAt: '2026-09-18T02:00:00.000Z',
        canUndo: false,
      }),
    ])
    render(<EditHistoryPanel projectId={projectId} api={api} />)

    expect(await screen.findByText('絵コンテの案を 27 件採用しました')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument()
    const when = formatEditBatchTime('2026-09-18T02:00:00.000Z')
    expect(screen.getByText(`${when} に取り消し済み`)).toBeInTheDocument()
  })

  it('押した記録の id をそのまま取り消しの口へ渡す', async () => {
    const batch = aBatch()
    const api = spyApi([batch])
    render(<EditHistoryPanel projectId={projectId} api={api} />)

    await userEvent.click(await screen.findByRole('button', { name: '元に戻す' }))

    await waitFor(() => {
      expect(api.undoCalls()).toEqual([batch.id])
    })
  })

  it('取り消したあと、その行は消えずに「取り消し済み」へ変わる', async () => {
    const batch = aBatch()
    const api = spyApi([batch])
    render(<EditHistoryPanel projectId={projectId} api={api} />)

    await userEvent.click(await screen.findByRole('button', { name: '元に戻す' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument()
    })
    // 行そのものは残る。
    expect(screen.getByText('粗編集を 49 件の Shot へ適用しました')).toBeInTheDocument()
  })

  it('**戻せなかったものを件数に畳まず、理由ごと出す**', async () => {
    const batch = aBatch()
    const api = spyApi([batch], {
      batch: { ...batch, undoneAt: '2026-09-18T02:00:00.000Z', canUndo: false },
      restored: [shotA],
      failed: [{ shotId: shotB, reason: 'Shot が見つかりません' }],
    })
    render(
      <EditHistoryPanel
        projectId={projectId}
        api={api}
        shotCodes={new Map([[shotB, 'S2']])}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: '元に戻す' }))

    expect(await screen.findByText('Shot が見つかりません', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('S2')).toBeInTheDocument()
    expect(screen.getByText('1 件を元に戻し、1 件は戻せませんでした')).toBeInTheDocument()
  })

  it('読めなかったことを握り潰さず画面に出す', async () => {
    const api: EditHistoryApi = {
      listEditBatches: vi.fn(() => Promise.reject(new Error('繋がりません'))),
      undoEditBatch: vi.fn(() => Promise.reject(new Error('呼ばれない'))),
    }
    render(<EditHistoryPanel projectId={projectId} api={api} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('変更の履歴を扱えませんでした')
  })

  it('1 件も無ければ、その旨を出す', async () => {
    const api = spyApi([])
    render(<EditHistoryPanel projectId={projectId} api={api} />)

    expect(await screen.findByText('まとめて変えた操作はまだありません')).toBeInTheDocument()
  })
})

describe('buildEditHistoryView', () => {
  it('まだ戻せる件数を概要に出す', () => {
    const view = buildEditHistoryView([
      aBatch(),
      aBatch({ canUndo: false, undoneAt: '2026-09-18T02:00:00.000Z' }),
    ])
    expect(view.summary).toBe('2 件のうち、1 件が元に戻せます')
    expect(view.rows).toHaveLength(2)
  })

  it('取り消し済みかどうかを `undoneAt` で区別する（`canUndo` false と混ぜない）', () => {
    const [notUndoable] = buildEditHistoryView([aBatch({ canUndo: false })]).rows
    // **取り消せない ≠ 取り消した**（lessons L-021）。
    expect(notUndoable?.canUndo).toBe(false)
    expect(notUndoable?.undoneAt).toBeNull()
  })

  it('種別の見出しを出す', () => {
    const [row] = buildEditHistoryView([aBatch({ kind: 'bulk_update' })]).rows
    expect(row?.kindLabel).toBe('Shot の一括変更')
  })
})

describe('buildUndoResultView', () => {
  it('全部戻れば件数だけを出す', () => {
    const view = buildUndoResultView({
      batch: aBatch(),
      restored: [shotA, shotB],
      failed: [],
    })
    expect(view.summary).toBe('2 件を元に戻しました')
    expect(view.tone).toBe('normal')
    expect(view.failed).toEqual([])
  })

  it('戻せなかった分があれば、その件数と理由の両方を残す', () => {
    const view = buildUndoResultView({
      batch: aBatch(),
      restored: [],
      failed: [{ shotId: shotA, reason: 'この Project の Shot ではありません' }],
    })
    expect(view.summary).toBe('0 件を元に戻し、1 件は戻せませんでした')
    expect(view.tone).toBe('warn')
    expect(view.failed[0]?.reason).toBe('この Project の Shot ではありません')
  })
})
