import {
  canonicalJson,
  clipSnapshotOf,
  type ClipSnapshot,
  type EditBatch,
  type EditBatchClipEdit,
  type EditBatchLineEntry,
  type ProjectId,
  type TimelineClip,
} from '@ixa/domain'
import type { EditBatchRecorder } from './edit-batch-recording.js'

/**
 * クリップ 1 件ずつの作る・直す・消すを、**書く前に**記録する（`clip_edit`。2026-10-19）。
 * 制作者「『この効果音を消す』を押して消したけど、元に戻したい時に UNDO できなかった」。
 *
 * 記録は API のクリップの口で作る。画面の呼び手に任せると、MCP や別の画面からの操作が漏れる。
 * 記録の形は `@ixa/domain` の `edit-batch-clip-edit.ts` が持つ。
 */

export type ClipEditDraft = {
  readonly projectId: ProjectId
  readonly summary: string
  readonly edits: readonly EditBatchClipEdit[]
  /** ナレーションのテロップを消すと、行が「テロップなし」になる。戻すときに行も戻す。 */
  readonly lineEntries?: readonly EditBatchLineEntry[]
}

/** 記録する。**1 件も無ければ作らない**（`null`）。空の記録は「戻せない行」として履歴に積もる。 */
export const recordClipEdits = async (recorder: EditBatchRecorder, draft: ClipEditDraft): Promise<EditBatch | null> => {
  const lineEntries = draft.lineEntries ?? []
  if (draft.edits.length === 0 && lineEntries.length === 0) return null
  return await recorder.create({
    projectId: draft.projectId,
    kind: 'clip_edit',
    summary: draft.summary,
    entries: [],
    clipEdits: [...draft.edits],
    lineEntries: [...lineEntries],
  })
}

/** 直す欄（検証を通した後の形。既定値は埋まっている）。 */
export type ClipPatch = Partial<ClipSnapshot>

/** 直した後の形。送られなかった欄は今の値のまま。 */
const afterPatch = (before: ClipSnapshot, patch: ClipPatch): ClipSnapshot => ({
  track: patch.track ?? before.track,
  startSec: patch.startSec ?? before.startSec,
  durationSec: patch.durationSec ?? before.durationSec,
  layer: patch.layer ?? before.layer,
  content: patch.content ?? before.content,
  opacity: patch.opacity ?? before.opacity,
})

/**
 * 直す 1 件の記録。**何も変わらないなら `null`**（同じ値を送り直しただけの操作を履歴に並べない）。
 * 比べるのは丸ごとの形で、中身（`content`）は並びに左右されない書き方（`canonicalJson`）で比べる。
 */
export const updateEditOf = (clip: TimelineClip, patch: ClipPatch): EditBatchClipEdit | null => {
  const before = clipSnapshotOf(clip)
  return canonicalJson(before) === canonicalJson(afterPatch(before, patch))
    ? null
    : { op: 'update', clipId: clip.id, before }
}

/** 実際に値が変わる欄（見出しの「動かす」「直す」の判定に使う）。 */
export const changedFieldsOf = (clip: TimelineClip, patch: ClipPatch): readonly string[] => {
  const before = clipSnapshotOf(clip)
  const after = afterPatch(before, patch)
  return (Object.keys(before) as (keyof ClipSnapshot)[]).filter(
    (key) => canonicalJson(before[key]) !== canonicalJson(after[key]),
  )
}
