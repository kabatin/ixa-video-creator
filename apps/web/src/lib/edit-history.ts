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
  music_trim: '曲を最後の Shot で切る',
  clip_edit: 'クリップの編集',
  shot_edit: 'Shot の編集',
  narration_edit: 'ナレーションの編集',
  transition_edit: 'トランジションの編集',
  music_edit: '楽曲の編集',
  project_edit: '作品の編集',
  asset_edit: '素材の編集',
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
export const editBatchCountLabel = (batch: WireEditBatch): string => {
  // クリップ 1 件ずつの記録は効果音・エフェクトも含むので、テロップと呼ばない。
  if (batch.kind === 'clip_edit') return `${batch.clipCount.toString()} 件のクリップ`
  // 作品の直しは 1 つの作品の欄なので、件数で言わない。
  if (batch.kind === 'project_edit') return '作品'
  if (batch.shotCount > 0) return `${batch.shotCount.toString()} 件の Shot`
  if (batch.lineCount > 0) return `${batch.lineCount.toString()} 行のナレーション`
  if (batch.clipCount > 0) return `${batch.clipCount.toString()} 件のテロップ`
  if ((batch.musicCount ?? 0) > 0) return `${String(batch.musicCount)} 曲`
  if ((batch.transitionCount ?? 0) > 0) return `${String(batch.transitionCount)} 件のトランジション`
  if ((batch.assetCount ?? 0) > 0) return `${String(batch.assetCount)} 件の素材`
  return `${batch.shotCount.toString()} 件の Shot`
}

const toRow = (batch: WireEditBatch): EditHistoryRow => ({
  key: batch.id,
  id: batch.id,
  kindLabel: editBatchKindLabel(batch.kind),
  summary: batch.summary,
  when: formatEditBatchTime(batch.createdAt),
  shotCountLabel: editBatchCountLabel(batch),
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
  /** 戻せなかったクリップ・ナレーションの行・曲。同じく 1 件ずつ理由を出す（`subject` は何が戻らなかったか）。 */
  readonly failedClips: readonly { readonly key: string; readonly subject: string; readonly reason: string }[]
}

/** 戻した結果のうち、どれか 1 つの種類（Shot・クリップ・ナレーションの行・曲）。 */
type UndoGroup = {
  /** 見出しの主語（「クリップ 」「ナレーション 」）。Shot は今までどおり主語を付けない。 */
  readonly subject: string
  /** 数え方（行は「行」、ほかは「件」）。 */
  readonly unit: string
  readonly restored: number
  readonly failed: readonly { readonly key: string; readonly subject: string; readonly reason: string }[]
}

const groupsOf = (result: WireUndoResult): readonly UndoGroup[] => {
  const clipNoun = result.batch.kind === 'clip_edit' ? 'クリップ' : 'テロップ'
  const lines = { restored: result.restoredLines ?? [], failed: result.failedLines ?? [] }
  const music = { restored: result.restoredMusicTracks ?? [], failed: result.failedMusicTracks ?? [] }
  const transitions = { restored: result.restoredTransitions ?? [], failed: result.failedTransitions ?? [] }
  const assets = { restored: result.restoredAssets ?? [], failed: result.failedAssets ?? [] }
  return [
    {
      subject: `${clipNoun} `,
      unit: '件',
      restored: result.restoredClips.length,
      failed: result.failedClips.map((entry, index) => ({
        key: `failed-clip:${entry.clipId}:${index.toString()}`,
        subject: clipNoun,
        reason: entry.reason,
      })),
    },
    // 素材は行より先（声を消すと行も「声が未定」になる。見出しは声で言う）。
    {
      subject: '素材 ',
      unit: '件',
      restored: assets.restored.length,
      failed: assets.failed.map((entry, index) => ({
        key: `failed-asset:${entry.assetId}:${index.toString()}`,
        subject: '素材',
        reason: entry.reason,
      })),
    },
    {
      subject: 'ナレーション ',
      unit: '行',
      restored: lines.restored.length,
      failed: lines.failed.map((entry, index) => ({
        key: `failed-line:${entry.lineId}:${index.toString()}`,
        subject: 'ナレーションの行',
        reason: entry.reason,
      })),
    },
    {
      subject: '曲 ',
      unit: '件',
      restored: music.restored.length,
      failed: music.failed.map((entry, index) => ({
        key: `failed-music:${entry.musicTrackId}:${index.toString()}`,
        subject: '曲',
        reason: entry.reason,
      })),
    },
    {
      subject: 'トランジション ',
      unit: '件',
      restored: transitions.restored.length,
      failed: transitions.failed.map((entry, index) => ({
        key: `failed-transition:${entry.transitionId}:${index.toString()}`,
        subject: 'トランジション',
        reason: entry.reason,
      })),
    },
  ]
}

/** 何か 1 つでも戻ったか（画面を読み直す合図）。行・曲だけが戻った記録も数える。 */
export const undoRestoredAnything = (result: WireUndoResult): boolean =>
  result.restored.length > 0 || result.restoredProject === true || groupsOf(result).some((group) => group.restored > 0)

/** 作品の直しの記録の結果（作品は 1 つなので件数で言わない）。作品を触っていない記録なら `null`。 */
const projectResultView = (result: WireUndoResult): UndoResultView | null => {
  const reason = result.failedProject ?? null
  if (result.restoredProject !== true && reason === null) return null
  return reason === null
    ? { summary: '作品を元に戻しました', tone: 'normal', failed: [], failedClips: [] }
    : {
        summary: '作品を元に戻せませんでした',
        tone: 'warn',
        failed: [],
        failedClips: [{ key: 'failed-project', subject: '作品', reason }],
      }
}

/**
 * 取り消しの結果を読める形に写す。
 *
 * **戻せなかった分を件数だけにしない。** 理由がなければ、人は
 * 「なぜこの Shot だけ戻っていないのか」を自分で探すことになる。
 * 見出しは、その記録が持つもののうち最初の種類（クリップ → 素材 → ナレーションの行 → 曲 → トランジション）で言う。
 * どれも無ければ Shot の記録として言う。
 */
export const buildUndoResultView = (result: WireUndoResult): UndoResultView => {
  const project = projectResultView(result)
  if (project !== null) return project
  const groups = groupsOf(result)
  const main = groups.find((group) => group.restored + group.failed.length > 0) ?? {
    subject: '',
    unit: '件',
    restored: result.restored.length,
    failed: result.failed.map((entry) => ({ key: entry.shotId, subject: 'Shot', reason: entry.reason })),
  }
  const failed = main.failed.length
  return {
    summary:
      failed === 0
        ? `${main.subject}${main.restored.toString()} ${main.unit}を元に戻しました`
        : `${main.subject}${main.restored.toString()} ${main.unit}を元に戻し、${failed.toString()} ${main.unit}は戻せませんでした`,
    tone: failed === 0 ? 'normal' : 'warn',
    // 戻せなかったクリップ・行・曲も、1 件ずつ理由を出す。
    failedClips: groups.flatMap((group) => group.failed),
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
