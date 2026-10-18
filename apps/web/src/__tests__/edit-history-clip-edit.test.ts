import { EditBatchId as EditBatchIdSchema, TimelineClipId as TimelineClipIdSchema, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { buildEditHistoryView, buildUndoResultView } from '@/lib/edit-history'
import type { WireEditBatch } from '@/lib/edit-history-api'

/**
 * クリップ 1 件ずつの作る・直す・消すの記録（制作者 2026-10-19「『この効果音を消す』を押して消したけど、
 * 元に戻したい時に UNDO できなかった」）。履歴と戻した結果を、テロップに限らず「クリップ」で言う。
 */

const batch: WireEditBatch = {
  id: newId(EditBatchIdSchema),
  kind: 'clip_edit',
  summary: '効果音を消す',
  shotCount: 0,
  clipCount: 1,
  lineCount: 0,
  undoneAt: null,
  createdAt: '2026-10-19T01:00:00.000Z',
  canUndo: true,
}

describe('クリップの記録の履歴', () => {
  it('種類はクリップの編集、件数はクリップで言う（効果音をテロップと呼ばない）', () => {
    const [row] = buildEditHistoryView([batch]).rows
    expect(row?.kindLabel).toBe('クリップの編集')
    expect(row?.summary).toBe('効果音を消す')
    expect(row?.shotCountLabel).toBe('1 件のクリップ')
  })

  it('戻した結果もクリップで言い、戻せなかった理由を「クリップ」として残す', () => {
    const clipId = newId(TimelineClipIdSchema)
    const base = { batch, restored: [], failed: [] }
    expect(buildUndoResultView({ ...base, restoredClips: [clipId], failedClips: [] }).summary).toBe(
      'クリップ 1 件を元に戻しました',
    )
    const failed = buildUndoResultView({ ...base, restoredClips: [], failedClips: [{ clipId, reason: '見つかりません' }] })
    expect(failed.summary).toBe('クリップ 0 件を元に戻し、1 件は戻せませんでした')
    expect(failed.failedClips.map((entry) => entry.subject)).toEqual(['クリップ'])
  })
})
