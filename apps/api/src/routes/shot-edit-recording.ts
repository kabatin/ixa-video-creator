import {
  hasChanges,
  type EditBatch,
  type EditBatchEntry,
  type EditBatchShotEdit,
  type MediaAssetId,
  type Shot,
  type UpdateShotPatch,
} from '@ixa/domain'
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

/**
 * Shot の作成・削除を含む記録（作成・削除・分割・結合・一括削除）。尺などを直した Shot は `entries` に、
 * 作った・消した Shot は `shotEdits` に入れる。**何も無ければ作らない**（`null`）。
 */
export const recordShotEdits = async (
  recorder: EditBatchRecorder,
  draft: {
    readonly projectId: Shot['projectId']
    readonly summary: string
    readonly shotEdits: readonly EditBatchShotEdit[]
    readonly entries?: readonly EditBatchEntry[]
  },
): Promise<EditBatch | null> => {
  const entries = (draft.entries ?? []).filter(hasChanges)
  if (draft.shotEdits.length === 0 && entries.length === 0) return null
  return await recorder.create({
    projectId: draft.projectId,
    kind: 'shot_edit',
    summary: draft.summary,
    entries: [...entries],
    shotEdits: [...draft.shotEdits],
  })
}

/** 登場人物の比べ方（並びと値だけ。Shot の ID は見ない）。 */
const castKey = (cast: readonly NonNullable<EditBatchEntry['cast']>[number][]): string =>
  JSON.stringify(cast.map(({ characterId, lookId, prominence, order }) => [characterId, lookId, prominence, order]))

/**
 * 登場人物・開始フレーム・終わりの画像を変える前の記録（2026-10-19）。**変わらないなら作らない**（`null`）。
 * 登場人物は丸ごと、開始フレームと終わりの画像は付いていた素材（無ければ `null`）を控える。
 * 終わりの画像は Shot の欄（`timing`）も一緒に変えることがあるので、その前の値を `patch` に控える。
 */
export const recordShotAttachments = (
  recorder: EditBatchRecorder,
  shot: Shot,
  change:
    | { readonly kind: 'cast'; readonly before: NonNullable<EditBatchEntry['cast']>; readonly after: NonNullable<EditBatchEntry['cast']> }
    | { readonly kind: 'startFrame'; readonly before: MediaAssetId | null; readonly after: MediaAssetId | null }
    | {
        readonly kind: 'endFrame'
        readonly before: MediaAssetId | null
        readonly after: MediaAssetId | null
        /** 一緒に変える Shot の欄の、変える前の値。 */
        readonly patch: EditBatchEntry['patch']
      },
): Promise<EditBatch | null> => {
  const unchanged =
    change.kind === 'cast'
      ? castKey(change.before) === castKey(change.after)
      : change.before === change.after && (change.kind === 'startFrame' || Object.keys(change.patch).length === 0)
  if (unchanged) return Promise.resolve(null)
  return recordEditBatch(recorder, {
    projectId: shot.projectId,
    kind: 'shot_edit',
    summarize: () => `${shot.code} の${ATTACHMENT_LABELS[change.kind]}を変える`,
    entries: [attachmentEntry(shot, change)],
  })
}

const ATTACHMENT_LABELS = { cast: '登場人物', startFrame: '開始フレーム', endFrame: '終わりの画像' } as const

const attachmentEntry = (
  shot: Shot,
  change: Parameters<typeof recordShotAttachments>[2],
): EditBatchEntry => {
  switch (change.kind) {
    case 'cast':
      return { shotId: shot.id, patch: {}, cast: [...change.before] }
    case 'startFrame':
      return { shotId: shot.id, patch: {}, startFrame: change.before }
    case 'endFrame':
      return { shotId: shot.id, patch: change.patch, endFrame: change.before }
  }
}
