import type {
  EditBatch,
  EditBatchKind,
  EditBatchEntry,
  EditBatchPatch,
  ProjectId,
  Shot,
  ShotId,
  ShotStatus,
  TakeId,
  UpdateShotPatch,
} from '@ixa/domain'
import { EditBatchPatch as EditBatchPatchSchema, hasChanges } from '@ixa/domain'
import type { EditBatchRepository } from '@ixa/db'

/**
 * 一括で変える**直前**に、変える欄の現在値を集めて記録を作る（P64-1）。
 *
 * 記録の形と不変条件は `@ixa/domain` の `edit-batch.ts` が持つ。ここにあるのは
 * 「Shot の現在値から、変える前の断片をどう取り出すか」だけ。
 * **判定（`hasChanges`）は書き写さず domain のものを呼ぶ**（lessons L-016）。
 *
 * ★ **変えた欄だけを残す。** 「書き込む欄」ではなく「値が実際に変わる欄」で絞る。
 *   絞らないと、説明を同じ文字で採用し直しただけの操作まで履歴に並び、
 *   `hasChanges` が何も落とさなくなる。
 */

/** 記録を作る口だけ。履歴の読み出しは要らない（書く側に読む力を渡さない）。 */
export type EditBatchRecorder = Pick<EditBatchRepository, 'create'>

/**
 * 記録に入る `patch` の型。**契約（`EditBatchEntry`）の側から取る。**
 * `UpdateShotPatch` は zod の入力型で branded ID が剥がれており、
 * そのまま記録へ入れると型が合わない。
 */
type ShotBeforePatch = EditBatchEntry['patch']

/**
 * 記録に書ける欄は、すべて `Shot` の欄でもある。
 *
 * **`UpdateShotPatch` ではなく `EditBatchPatch` から取る。** `lockedAt` は記録に
 * 書けない（`Date` は jsonb から読み戻せず、ロックは人の判断で一括編集の一部でもない）。
 * 広い側から取ると、集める段でも検証する段でも素通りしてしまう。
 */
type PatchKey = keyof EditBatchPatch & keyof Shot

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 変わったと見なすか。
 *
 * `camera` は入れ子なので、参照ではなく**欄ごとに**見る。参照で比べると
 * 「景別だけ変える」で毎回 camera 全体が変更扱いになり、取り消しが
 * `lensMm` や `angle` まで巻き戻す。
 */
const isSameValue = (current: unknown, next: unknown): boolean => {
  if (current === next) return true
  if (current instanceof Date && next instanceof Date) {
    return current.getTime() === next.getTime()
  }
  if (isRecord(current) && isRecord(next)) {
    const keys = new Set([...Object.keys(current), ...Object.keys(next)])
    return [...keys].every((key) => current[key] === next[key])
  }
  return false
}

/**
 * これから当てる `patch` に対する「変える前」。**値が変わる欄だけ**を返す。
 *
 * 戻り値は zod で検証してから返す（規約 4）。知らない欄は落ちるので、
 * `patch` に紛れ込んだ余計なキーが記録に入ることはない。
 */
export const shotBeforePatch = (shot: Shot, patch: UpdateShotPatch): ShotBeforePatch => {
  const changed = (Object.keys(patch) as PatchKey[])
    .filter((key) => patch[key] !== undefined && !isSameValue(shot[key], patch[key]))
    .map((key) => [key, shot[key]] as const)
  return EditBatchPatchSchema.parse(Object.fromEntries(changed))
}

/**
 * `patch` に載らない「変える前」。**渡さなかった欄は作らない。**
 *
 * `selectedTakeId` と `status` は不変条件を伴うため `UpdateShotPatch` では動かせず、
 * リポジトリの別の口（`selectTake` / `updateStatus`）が持つ。記録の側も別の欄で持つ。
 */
export type TouchedShotFields = {
  /** `null` は「採用していなかった」。**渡さなければ「触っていない」。** */
  readonly selectedTakeId?: TakeId | null
  readonly status?: ShotStatus
}

/**
 * 記録 1 件ぶんを組み立てる。
 *
 * ★ **渡さなかった欄は、欄そのものを作らない。**
 *   「触っていない」は欄が無いことで表し、`selectedTakeId: null` は
 *   「採用していなかった」を指す。両方を `null` にすると区別が消える（lessons L-021）。
 */
export const editBatchEntry = (
  shotId: ShotId,
  patch: ShotBeforePatch,
  touched: TouchedShotFields = {},
): EditBatchEntry => ({
  shotId,
  patch,
  ...(touched.selectedTakeId === undefined ? {} : { selectedTakeId: touched.selectedTakeId }),
  ...(touched.status === undefined ? {} : { status: touched.status }),
})

export type EditBatchDraft = {
  readonly projectId: ProjectId
  readonly kind: EditBatchKind
  /**
   * 見出し。**実際に記録した件数**を受け取って組み立てる。
   * 呼ぶ側で件数を数えると、絞り込みで落ちた分だけ見出しがずれる。
   */
  readonly summarize: (shotCount: number) => string
  readonly entries: readonly EditBatchEntry[]
}

/**
 * 記録を残す。**1 件も変わらなかった操作では作らない**（`null` を返す）。
 *
 * 空の記録を残すと、履歴に「取り消せない行」が積み上がり、
 * 本当に戻したい操作が埋もれる。
 */
export const recordEditBatch = async (
  recorder: EditBatchRecorder,
  draft: EditBatchDraft,
): Promise<EditBatch | null> => {
  const entries = draft.entries.filter(hasChanges)
  if (entries.length === 0) return null
  return await recorder.create({
    projectId: draft.projectId,
    kind: draft.kind,
    summary: draft.summarize(entries.length),
    entries: [...entries],
  })
}
