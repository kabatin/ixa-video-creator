/**
 * @vitest-environment jsdom
 */
import {
  EditBatchId as EditBatchIdSchema,
  ProjectId as ProjectIdSchema,
  newId,
} from '@ixa/domain'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  undoConfirmMessage,
  useEditHistory,
  type EditHistoryState,
  type UndoTarget,
} from '@/components/workbench/use-edit-history'
import type { WireEditBatch, WireUndoResult } from '@/lib/edit-history-api'

/**
 * ⌘Z / メニュー「元に戻す」（S2・S4）。見たいのは 3 点。
 *
 * 1. **確認するまで取り消しの API を呼ばない。** 拾うのは「自分の 1 手」ではなく
 *    その Project の履歴の先頭で、他人の・1 時間前の一括操作でありうる
 * 2. 確認の文に「何が」「いつ」「何件」戻るのかが入る
 * 3. 履歴を読めなかったときに「戻せるものがありません」と嘘をつかない（lessons L-015）
 */

const projectId = newId(ProjectIdSchema)

const SUMMARY = '粗編集を 49 件の Shot へ適用しました'

const aBatch = (overrides: Partial<WireEditBatch> = {}): WireEditBatch => ({
  id: newId(EditBatchIdSchema),
  kind: 'rough_cut',
  summary: SUMMARY,
  shotCount: 49,
  undoneAt: null,
  createdAt: '2026-09-18T01:00:00.000Z',
  canUndo: true,
  ...overrides,
})

/** 呼ばれた取り消しの id。**空のままであることを確かめるために持つ。** */
const undoCalls: string[] = []

let listResponse: () => Promise<WireEditBatch[]> = () => Promise.resolve([])

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    listEditBatches: (): Promise<WireEditBatch[]> => listResponse(),
    undoEditBatch: (_projectId: string, id: string): Promise<WireUndoResult> => {
      undoCalls.push(id)
      const batch = aBatch({ id: EditBatchIdSchema.parse(id), canUndo: false })
      return Promise.resolve({
        batch: { ...batch, undoneAt: '2026-09-18T02:00:00.000Z' },
        restored: [],
        failed: [],
      })
    },
  }),
}))

beforeEach(() => {
  undoCalls.length = 0
  listResponse = () => Promise.resolve([])
})

const mount = (): { readonly current: EditHistoryState } =>
  renderHook(() => useEditHistory(projectId, 0)).result

const pendingOf = (history: EditHistoryState): UndoTarget => {
  const target = history.canUndo.pending
  if (target === null) throw new Error('確認待ちの対象がありません')
  return target
}

describe('確認してから戻す（S2）', () => {
  it('⌘Z は確認を開くだけで、取り消しの API を呼ばない', async () => {
    const batch = aBatch()
    listResponse = () => Promise.resolve([batch])
    const result = mount()
    await waitFor(() => {
      expect(result.current.canUndo.availability.state).toBe('ready')
    })

    let notice: string | null = '通知が返らなかった'
    await act(async () => {
      notice = await result.current.undoLatest()
    })

    expect(undoCalls).toEqual([])
    expect(notice).toBeNull()
    expect(pendingOf(result.current).id).toBe(batch.id)
  })

  it('確認の文に、何が・いつ・何件戻るのかと、取り消せないことが入る', async () => {
    listResponse = () => Promise.resolve([aBatch()])
    const result = mount()
    await waitFor(() => {
      expect(result.current.canUndo.availability.state).toBe('ready')
    })
    await act(async () => {
      await result.current.undoLatest()
    })

    const message = undoConfirmMessage(pendingOf(result.current))
    expect(message).toContain(SUMMARY)
    expect(message).toContain('49 件')
    expect(message).toContain('2026')
    expect(message).toContain('取り消せません')
  })

  it('やめると、確認が閉じて何も実行されない', async () => {
    listResponse = () => Promise.resolve([aBatch()])
    const result = mount()
    await waitFor(() => {
      expect(result.current.canUndo.availability.state).toBe('ready')
    })
    await act(async () => {
      await result.current.undoLatest()
    })

    act(() => {
      result.current.canUndo.cancel()
    })

    expect(result.current.canUndo.pending).toBeNull()
    expect(undoCalls).toEqual([])
  })

  it('確認してはじめて取り消しの API を呼び、戻した対象を通知に出す', async () => {
    const batch = aBatch()
    listResponse = () => Promise.resolve([batch])
    const result = mount()
    await waitFor(() => {
      expect(result.current.canUndo.availability.state).toBe('ready')
    })
    await act(async () => {
      await result.current.undoLatest()
    })

    let notice = ''
    await act(async () => {
      notice = await result.current.canUndo.confirm()
    })

    expect(undoCalls).toEqual([batch.id])
    expect(notice).toContain(SUMMARY)
    expect(notice).toContain('戻しました')
    expect(result.current.canUndo.pending).toBeNull()
  })

  it('メニューに出す見出しは、戻る対象そのもの', async () => {
    listResponse = () => Promise.resolve([aBatch({ summary: '絵コンテを 3 件採用しました' })])
    const result = mount()
    await waitFor(() => {
      expect(result.current.canUndo.availability.state).toBe('ready')
    })

    const { availability } = result.current.canUndo
    if (availability.state !== 'ready' || availability.target === null) {
      throw new Error('戻せる対象がありません')
    }
    expect(availability.target.summary).toBe('絵コンテを 3 件採用しました')
    expect(availability.target.shotCount).toBe(49)
  })
})

describe('履歴を読めなかったとき（S4）', () => {
  it('「戻せるものがありません」と言わず、読めなかったことを返す', async () => {
    listResponse = () => Promise.reject(new Error('offline'))
    const result = mount()
    await waitFor(() => {
      expect(result.current.canUndo.availability.state).toBe('unreadable')
    })

    let notice: string | null = null
    await act(async () => {
      notice = await result.current.undoLatest()
    })

    expect(notice).toContain('履歴を読めませんでした')
    expect(notice).not.toContain('戻せる一括操作がありません')
    expect(undoCalls).toEqual([])
    expect(result.current.canUndo.pending).toBeNull()
  })

  it('0 件のときとは別の文を返す（3 つの状態を畳まない）', async () => {
    listResponse = () => Promise.resolve([])
    const empty = mount()
    await waitFor(() => {
      expect(empty.current.canUndo.availability.state).toBe('none')
    })
    let emptyNotice: string | null = null
    await act(async () => {
      emptyNotice = await empty.current.undoLatest()
    })

    listResponse = () => Promise.reject(new Error('offline'))
    const broken = mount()
    await waitFor(() => {
      expect(broken.current.canUndo.availability.state).toBe('unreadable')
    })
    let brokenNotice: string | null = null
    await act(async () => {
      brokenNotice = await broken.current.undoLatest()
    })

    expect(emptyNotice).toBe('戻せる一括操作がありません。')
    expect(brokenNotice).not.toBe(emptyNotice)
  })

  it('まだ読めていない間は、0 件とも読めなかったとも言わない', async () => {
    listResponse = () => new Promise<WireEditBatch[]>(() => undefined)
    const result = mount()

    expect(result.current.canUndo.availability.state).toBe('loading')
    let notice: string | null = null
    await act(async () => {
      notice = await result.current.undoLatest()
    })

    expect(notice).toBe('履歴をまだ読み込んでいません。')
    expect(undoCalls).toEqual([])
  })

  it('取り消せない一括操作しか無ければ 0 件（判定はサーバの canUndo）', async () => {
    listResponse = () =>
      Promise.resolve([aBatch({ canUndo: false, undoneAt: '2026-09-18T02:00:00.000Z' })])
    const result = mount()
    await waitFor(() => {
      expect(result.current.canUndo.availability.state).toBe('none')
    })
  })
})
