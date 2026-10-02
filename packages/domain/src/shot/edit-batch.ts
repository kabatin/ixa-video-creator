import { z } from 'zod'
import { EditBatchId, ProjectId, ShotId, TakeId, TimelineClipId } from '../common/ids.js'
import { ShotStatus, UpdateShotPatch } from './shot.js'

/**
 * 一括で変えた記録と、その取り消し（横断 ROADMAP: Undo と履歴）。
 *
 * **一度に大量の行が変わる操作だけを対象にする。** 粗編集の適用（最大 49 件）・
 * 絵コンテ下書きの採用（27 件）・Shot の一括変更は、押した瞬間に全部変わる。
 * 個々のキー入力まで戻せる必要は無く、「さっきの一括を取り消したい」が
 * 戻せれば怖さは消える。
 *
 * **記録は追記のみ。** 中身は書き換えず、取り消したかどうかだけが後から動く
 * （Take・絵コンテの案と同じ考え方・ADR-0003）。
 */

/** `text_style` はテロップの見た目のまとめ変更（2026-10-02）。Shot ではなくテロップを記録する（`clipEntries`）。 */
export const EditBatchKind = z.enum(['rough_cut', 'draft_adopt', 'bulk_update', 'text_style'])
export type EditBatchKind = z.infer<typeof EditBatchKind>

/**
 * Shot 1 件ぶんの「変える前」。
 *
 * **変えた欄だけを持つ。** 全欄を持つと、取り消しが「その後に人が直した欄」まで
 * 巻き戻してしまう。変えた欄だけを戻せば、無関係な編集は残る。
 */
/**
 * 記録に書ける欄。**`lockedAt` は書けない。**
 *
 * 2 つの理由がある。
 * 1. ロックは人が「ここは触らない」と決める行為で、一括編集の一部ではない。
 *    一括を取り消したときにロックまで戻すと、人の判断を機械が覆す
 * 2. `lockedAt` は `Date` で、`entries` は jsonb。書けてしまうと保存では通り、
 *    **読み出しの `parse` で落ちる**。いまは誰も書いていないが、契約上は書けた
 *
 * 型で禁じておけば、次に書こうとした人はコンパイルで気付く。
 */
export const EditBatchPatch = UpdateShotPatch.omit({ lockedAt: true })
export type EditBatchPatch = z.infer<typeof EditBatchPatch>

export const EditBatchEntry = z.object({
  shotId: ShotId,
  /** 変えた欄の、変える前の値。欄を 1 つも変えていなければ空。 */
  patch: EditBatchPatch,
  /**
   * 採用 Take を変えたときだけ持つ。
   *
   * **「触っていない」は欄が無いことで表す。`null` は「採用していなかった」。**
   * 両方を `null` にすると、採用を外したのか触っていないのかが区別できなくなる
   * （lessons L-021）。
   */
  selectedTakeId: TakeId.nullable().optional(),
  /**
   * 状態を変えたときだけ持つ。**欄が無いのは「触っていない」。**
   *
   * 一括採用（`bulk/select-take`）は採用 Take と状態の両方を動かす。
   * 状態を戻さないと、採用だけ戻って状態が新しいまま残り、
   * **取り消したのに中途半端**になる。片方だけ戻すくらいなら、
   * 戻せる範囲を型で正直に表して両方戻す。
   */
  status: ShotStatus.optional(),
})
export type EditBatchEntry = z.infer<typeof EditBatchEntry>

/**
 * テロップ 1 件ぶんの「変える前」（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * まとめて変えるのは見た目（`params.style`）とどのスタイルからか（`params.styleId`）だけなので、その 2 つを持つ。
 * **見た目は書いてあったそのまま**を持つ（読めない見た目も、そのまま戻す。読み替えない）。
 */
export const EditBatchClipEntry = z.object({
  clipId: TimelineClipId,
  style: z.unknown(),
  styleId: z.string().nullable(),
})
export type EditBatchClipEntry = z.infer<typeof EditBatchClipEntry>

export const MAX_EDIT_BATCH_SUMMARY_LENGTH = 200

export const EditBatch = z.object({
  id: EditBatchId,
  projectId: ProjectId,
  kind: EditBatchKind,
  /** 人が読む見出し。「粗編集を 49 件適用しました」など。履歴に並べる。 */
  summary: z.string().trim().min(1).max(MAX_EDIT_BATCH_SUMMARY_LENGTH),
  entries: z.array(EditBatchEntry),
  /** テロップの記録。これまでの記録（Shot だけ）は空として読む。 */
  clipEntries: z.array(EditBatchClipEntry).default([]),
  /** 取り消した時刻。**`null` は「まだ取り消していない」**（「取り消せない」ではない）。 */
  undoneAt: z.date().nullable(),
  createdAt: z.date(),
})
export type EditBatch = z.infer<typeof EditBatch>

export const CreateEditBatchInput = EditBatch.omit({
  id: true,
  undoneAt: true,
  createdAt: true,
})
export type CreateEditBatchInput = z.input<typeof CreateEditBatchInput>

/** 記録のうち作成後に変えてよい列。**`undoneAt` だけ。** */
export const EDIT_BATCH_MUTABLE_FIELDS = Object.freeze(['undoneAt'] as const)

export const isUndone = (batch: EditBatch): boolean => batch.undoneAt !== null

/**
 * 取り消せるか。
 *
 * **一度取り消した記録は二度取り消さない。** もう一度当てると、その後に人が
 * 直した内容を古い値で塗り潰す。戻したものをやり直したいなら、新しく操作する。
 */
export const canUndo = (batch: EditBatch): boolean =>
  !isUndone(batch) && (batch.entries.length > 0 || batch.clipEntries.length > 0)

/**
 * 1 件ぶんの取り消しで、採用 Take を戻す必要があるか。
 *
 * 欄が無い（`undefined`）なら触っていないので戻さない。
 * `null` は「採用していなかった」なので、採用を外す方向に戻す。
 */
export const undoTouchesSelectedTake = (entry: EditBatchEntry): boolean =>
  'selectedTakeId' in entry && entry.selectedTakeId !== undefined

/** 状態を戻す必要があるか。欄が無ければ触っていないので戻さない。 */
export const undoTouchesStatus = (entry: EditBatchEntry): boolean => entry.status !== undefined

/** 欄を 1 つも変えていない記録は残さない。数だけ増えて履歴が読めなくなる。 */
export const hasChanges = (entry: EditBatchEntry): boolean =>
  Object.keys(entry.patch).length > 0 ||
  undoTouchesSelectedTake(entry) ||
  undoTouchesStatus(entry)
