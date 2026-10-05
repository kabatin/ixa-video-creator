import type { EditBatchId, EditBatchKind, ShotId } from '@ixa/domain'
import type { WireEditBatch, WireUndoResult } from '@/lib/edit-history-api'

/**
 * 一括で変えた操作の履歴を読める形に写す（P64-1）。**React を含まない純粋関数だけ。**
 *
 * ここでは**何も判定しない。** 取り消せるかどうかを決めたのはサーバで、
 * この画面が触るのは見出し・並び順・日時の書式といった
 * 「ズレても壊れないもの」だけ（lessons L-016）。
 *
 * いちばん間違えやすいのは、**取り消し済みの行を消してしまう**ことだ。
 * 消すと「取り消した」という事実まで履歴から消え、
 * 何が起きたのか誰にも分からなくなる。**消さずに、その旨を出す。**
 */

/** 色は役割の名前で持つ（PHASE 5.9）。素の色名は部品に書かない。 */
export type EditHistoryTone = 'normal' | 'muted' | 'warn'

const KIND_LABELS: Readonly<Record<EditBatchKind, string>> = Object.freeze({
  rough_cut: '粗編集の適用',
  draft_adopt: '絵コンテの採用',
  bulk_update: 'Shot の一括変更',
  text_style: 'テロップの見た目の一括変更',
  narration_arrange: 'ナレーションをまとめて並べる',
})

export const editBatchKindLabel = (kind: EditBatchKind): string => KIND_LABELS[kind]

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** ISO 文字列を読める日時にする。読めない値はそのまま出す（握り潰さない）。 */
export const formatEditBatchTime = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : dateFormatter.format(at)
}

export type EditHistoryRow = {
  readonly key: string
  /** 取り消しの口に渡す識別子。**画面で文字列から作り直さない。** */
  readonly id: EditBatchId
  readonly kindLabel: string
  readonly summary: string
  /** いつ変えたか。 */
  readonly when: string
  /** 何件を変えたか（Shot・テロップ・ナレーションの行のうち、その記録が持つもの）。 */
  readonly shotCountLabel: string
  /** 「元に戻す」を出すか。**判定はサーバの `canUndo` をそのまま使う。** */
  readonly canUndo: boolean
  /**
   * 取り消し済みなら、いつ取り消したか。**まだなら `null`。**
   * `canUndo` が false でもここが `null` なら「取り消せない」であって
   * 「取り消した」ではない（lessons L-021）。
   */
  readonly undoneAt: string | null
  readonly tone: EditHistoryTone
}

/**
 * 何件変えたか。**その記録が持つものの件数で言う。**
 * テロップの見た目のまとめ変更（2026-10-02）はテロップ、ナレーションをまとめて並べる（ADR-0038）は行。
 */
const countLabelOf = (batch: WireEditBatch): string => {
  if (batch.shotCount > 0) return `${batch.shotCount.toString()} 件の Shot`
  if (batch.lineCount > 0) return `${batch.lineCount.toString()} 行のナレーション`
  if (batch.clipCount > 0) return `${batch.clipCount.toString()} 件のテロップ`
  return `${batch.shotCount.toString()} 件の Shot`
}

const toRow = (batch: WireEditBatch): EditHistoryRow => ({
  key: batch.id,
  id: batch.id,
  kindLabel: editBatchKindLabel(batch.kind),
  summary: batch.summary,
  when: formatEditBatchTime(batch.createdAt),
  shotCountLabel: countLabelOf(batch),
  canUndo: batch.canUndo,
  undoneAt: batch.undoneAt === null ? null : formatEditBatchTime(batch.undoneAt),
  tone: batch.undoneAt !== null ? 'muted' : 'normal',
})

export type EditHistoryView = {
  readonly rows: readonly EditHistoryRow[]
  /** 概要の 1 行。**まだ戻せる件数を必ず出す。** */
  readonly summary: string
  readonly isEmpty: boolean
}

export const buildEditHistoryView = (batches: readonly WireEditBatch[]): EditHistoryView => {
  const undoable = batches.filter((batch) => batch.canUndo).length
  return {
    rows: batches.map(toRow),
    summary:
      batches.length === 0
        ? 'まとめて変えた操作はまだありません'
        : `${batches.length.toString()} 件のうち、${undoable.toString()} 件が元に戻せます`,
    isEmpty: batches.length === 0,
  }
}

export type UndoFailureView = {
  readonly key: string
  readonly shotId: ShotId
  readonly reason: string
}

export type UndoResultView = {
  readonly summary: string
  readonly tone: EditHistoryTone
  /** 戻せなかった分。**件数に畳まず、1 件ずつ理由を出す**（lessons L-015）。 */
  readonly failed: readonly UndoFailureView[]
  /** 戻せなかったテロップ。同じく 1 件ずつ理由を出す。 */
  readonly failedClips: readonly { readonly key: string; readonly reason: string }[]
}

/**
 * 取り消しの結果を読める形に写す。
 *
 * **戻せなかった分を件数だけにしない。** 理由がなければ、人は
 * 「なぜこの Shot だけ戻っていないのか」を自分で探すことになる。
 */
export const buildUndoResultView = (result: WireUndoResult): UndoResultView => {
  // テロップの記録（見た目のまとめ変更）ならテロップの件数で言う。Shot の記録は今までどおり。
  const clips = result.restoredClips.length + result.failedClips.length > 0
  const restored = clips ? result.restoredClips.length : result.restored.length
  const failed = clips ? result.failedClips.length : result.failed.length
  const subject = clips ? 'テロップ ' : ''
  return {
    summary:
      failed === 0
        ? `${subject}${restored.toString()} 件を元に戻しました`
        : `${subject}${restored.toString()} 件を元に戻し、${failed.toString()} 件は戻せませんでした`,
    tone: failed === 0 ? 'normal' : 'warn',
    failedClips: result.failedClips.map((entry, index) => ({
      key: `failed-clip:${entry.clipId}:${index.toString()}`,
      reason: entry.reason,
    })),
    failed: result.failed.map((entry, index) => ({
      key: `failed:${entry.shotId}:${index.toString()}`,
      shotId: entry.shotId,
      reason: entry.reason,
    })),
  }
}

/**
 * Shot の見出し。分かっていれば `code`、分からなければ ID をそのまま出す。
 * **省略しない。** 何の Shot か分からないと、戻っていないものを探しに行けない。
 */
export const editHistoryShotLabel = (
  shotId: ShotId,
  shotCodes?: ReadonlyMap<ShotId, string>,
): string => shotCodes?.get(shotId) ?? shotId
