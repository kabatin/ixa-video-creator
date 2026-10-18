import type { EditBatch, Shot, UpdateShotPatch } from '@ixa/domain'
import { editBatchEntry, recordEditBatch, shotBeforePatch, type EditBatchRecorder } from './edit-batch-recording.js'

/**
 * Shot 1 件の直し・採用 Take の決定と外しを、**書く前に**記録する（`shot_edit`。2026-10-19）。
 * これまで記録が残るのは一括操作だけで、1 件ずつ直した Shot は ⌘Z で戻らなかった。
 * 形は一括と同じ（変えた欄の、変える前の値）。何も変わらなければ記録しない（`recordEditBatch` が落とす）。
 */

/** 欄を直す前。変える欄だけを控える。 */
export const recordShotPatch = (
  recorder: EditBatchRecorder,
  shot: Shot,
  patch: UpdateShotPatch,
): Promise<EditBatch | null> =>
  recordEditBatch(recorder, {
    projectId: shot.projectId,
    kind: 'shot_edit',
    summarize: () => `${shot.code} を直す`,
    entries: [editBatchEntry(shot.id, shotBeforePatch(shot, patch))],
  })

/**
 * 採用 Take を決める・外す前。採用と状態の両方を控える（採用は状態も動かす。一括採用と同じ）。
 * 決め直しで採用が変わらなくても控える（状態の先読みは `applySelectedTake` の規則の書き写しになる）。
 */
export const recordTakeChoice = (
  recorder: EditBatchRecorder,
  shot: Shot,
  action: 'select' | 'unselect',
): Promise<EditBatch | null> =>
  recordEditBatch(recorder, {
    projectId: shot.projectId,
    kind: 'shot_edit',
    summarize: () => (action === 'select' ? `${shot.code} の採用 Take を決める` : `${shot.code} の採用を外す`),
    entries: [editBatchEntry(shot.id, {}, { selectedTakeId: shot.selectedTakeId, status: shot.status })],
  })
