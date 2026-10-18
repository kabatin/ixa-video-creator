import {
  EditBatchId as EditBatchIdSchema,
  NarrationLineId as NarrationLineIdSchema,
  TimelineClipId as TimelineClipIdSchema,
  newId,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { undoConfirmMessage, type UndoTarget } from '@/components/workbench/use-edit-history'
import { buildUndoResultView, editBatchCountLabel, undoRestoredAnything } from '@/lib/edit-history'
import type { WireEditBatch, WireUndoResult } from '@/lib/edit-history-api'

/**
 * 取り消しの言葉の不具合（2026-10-19 の見直し）。
 * - ナレーションをまとめて並べた記録を戻すと「0 件を元に戻しました」になっていた（行の結果を読んでいなかった）
 * - ⌘Z の確認が Shot 以外の記録でも「0 件の Shot が…」と言っていた
 * - ⌘Z は作品の履歴の先頭を拾うので、記録の無い操作の後では古い記録を戻しうる。古さを強く知らせる
 */

const aBatch = (overrides: Partial<WireEditBatch> = {}): WireEditBatch => ({
  id: newId(EditBatchIdSchema),
  kind: 'narration_arrange',
  summary: 'ナレーション 3 行を並べました',
  shotCount: 0,
  clipCount: 0,
  lineCount: 3,
  undoneAt: null,
  createdAt: '2026-10-19T01:00:00.000Z',
  canUndo: true,
  ...overrides,
})

const emptyResult = (batch: WireEditBatch): WireUndoResult => ({
  batch,
  restored: [],
  failed: [],
  restoredClips: [],
  failedClips: [],
})

describe('ナレーションの行を戻した結果', () => {
  const lineId = newId(NarrationLineIdSchema)

  it('戻した行の数で言う（0 件にしない）', () => {
    const view = buildUndoResultView({ ...emptyResult(aBatch()), restoredLines: [lineId, lineId, lineId], failedLines: [] })
    expect(view.summary).toBe('ナレーション 3 行を元に戻しました')
    expect(view.tone).toBe('normal')
  })

  it('戻せなかった行は理由ごと出す', () => {
    const view = buildUndoResultView({
      ...emptyResult(aBatch()),
      restoredLines: [],
      failedLines: [{ lineId, reason: '行が見つかりません' }],
    })
    expect(view.summary).toBe('ナレーション 0 行を元に戻し、1 行は戻せませんでした')
    expect(view.failedClips.map((entry) => [entry.subject, entry.reason])).toEqual([['ナレーションの行', '行が見つかりません']])
  })

  it('行だけ戻っても「戻した」と数える（画面を読み直す合図）', () => {
    expect(undoRestoredAnything({ ...emptyResult(aBatch()), restoredLines: [lineId], failedLines: [] })).toBe(true)
    expect(undoRestoredAnything(emptyResult(aBatch()))).toBe(false)
    const clip = newId(TimelineClipIdSchema)
    expect(undoRestoredAnything({ ...emptyResult(aBatch()), restoredClips: [clip] })).toBe(true)
  })
})

describe('⌘Z の確認の文', () => {
  const now = new Date('2026-10-19T01:02:00.000Z')
  const target = (batch: WireEditBatch): UndoTarget => ({
    id: batch.id,
    summary: batch.summary,
    countLabel: editBatchCountLabel(batch),
    when: '2026/10/19 10:00',
    createdAt: batch.createdAt,
  })

  it('Shot 以外の記録では、その記録が持つものの件数で言う', () => {
    const clip = aBatch({ kind: 'clip_edit', summary: '効果音を消す', lineCount: 0, clipCount: 1 })
    const message = undoConfirmMessage(target(clip), now)
    expect(message).toContain('「効果音を消す」')
    expect(message).toContain('1 件のクリップ')
    expect(message).not.toContain('Shot')

    expect(undoConfirmMessage(target(aBatch()), now)).toContain('3 行のナレーション')
  })

  it('直前（5 分未満）の操作なら古さを言わない', () => {
    expect(undoConfirmMessage(target(aBatch()), now)).not.toContain('前の操作です')
  })

  it('5 分以上前の操作なら、何分・何時間前かと、その後の操作は戻らないことを言う', () => {
    const old = aBatch({ createdAt: '2026-10-19T00:40:00.000Z' })
    const message = undoConfirmMessage(target(old), now)
    expect(message).toContain('22 分前の操作です')
    expect(message).toContain('その後')

    const older = aBatch({ createdAt: '2026-10-18T22:00:00.000Z' })
    expect(undoConfirmMessage(target(older), now)).toContain('3 時間前の操作です')
  })
})
