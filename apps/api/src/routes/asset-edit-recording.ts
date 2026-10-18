import type { EditRepositories } from '@ixa/db'
import {
  EditBatchAssetEdit as EditBatchAssetEditSchema,
  assetEditSummary,
  type EditBatchAssetEdit,
  type EditBatchLineEntry,
  type ProjectId,
} from '@ixa/domain'

/**
 * 素材（キャラクター・ロケーション・ブランド資産・声）の作る・直す・消すを、**書く前に**記録する（`asset_edit`。2026-10-19）。
 * 作った・消したものは ID だけ（論理削除なので中身は残る）、直したものは変えた欄の、変える前の値だけを控える。
 */

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 直す前の値（値が変わる欄だけ）。1 つも変わらなければ `null`（記録しない）。 */
export const changedBefore = <T extends object>(current: T, patch: Partial<T>): Partial<T> | null => {
  const changed = (Object.keys(patch) as (keyof T)[]).filter(
    (key) => patch[key] !== undefined && !sameValue(current[key], patch[key]),
  )
  return changed.length === 0 ? null : (Object.fromEntries(changed.map((key) => [key, current[key]])) as Partial<T>)
}

export const recordAssetEdit = async (
  recorder: EditRepositories['editBatches'],
  draft: {
    readonly projectId: ProjectId
    /** 見出しに入れる名前（「キャラクター「戦子」を消す」）。 */
    readonly name: string
    readonly edit: EditBatchAssetEdit
    /** 声を消すと、その声で話す行は「声が未定」になる。戻すときに行も戻す。 */
    readonly lineEntries?: readonly EditBatchLineEntry[]
  },
): Promise<void> => {
  // 控えは素材の直す口の規則で検証してから残す（規約 4）。
  const edit = EditBatchAssetEditSchema.parse(draft.edit)
  await recorder.create({
    projectId: draft.projectId,
    kind: 'asset_edit',
    summary: assetEditSummary(edit, draft.name),
    entries: [],
    assetEdits: [edit],
    lineEntries: [...(draft.lineEntries ?? [])],
  })
}
