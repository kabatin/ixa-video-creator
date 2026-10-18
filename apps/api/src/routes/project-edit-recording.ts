import {
  EditBatchProjectEntry as EditBatchProjectEntrySchema,
  type EditBatchProjectEntry,
  type Project,
  type UpdateProjectPatch,
} from '@ixa/domain'
import type { EditRepositories } from '@ixa/db'

/**
 * 作品の欄の直し（方針・歌詞・歌詞の時刻など）を、**書く前に**記録する（`project_edit`。2026-10-19）。
 * 変えた欄の、変える前の値だけを控える（その後に直した別の欄は、戻しても残る）。
 */

type PatchKey = keyof EditBatchProjectEntry['patch'] & keyof Project

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 変える前の値（値が変わる欄だけ）。何も変わらなければ `null`。 */
export const projectBeforeEntry = (project: Project, patch: UpdateProjectPatch): EditBatchProjectEntry | null => {
  const changed = (Object.keys(patch) as PatchKey[]).filter(
    (key) => patch[key] !== undefined && !sameValue(project[key], patch[key]),
  )
  if (changed.length === 0) return null
  return EditBatchProjectEntrySchema.parse({ patch: Object.fromEntries(changed.map((key) => [key, project[key]])) })
}

const LYRIC_FIELDS: ReadonlySet<string> = new Set(['lyrics', 'lyricCues', 'instrumental'])
const STYLE_FIELDS: ReadonlySet<string> = new Set(['styleGuide', 'avoid', 'styleReferenceAssetIds'])

/** 履歴の見出し。直した欄の組で言い分ける。 */
export const projectEditSummary = (entry: EditBatchProjectEntry): string => {
  const keys = Object.keys(entry.patch)
  if (keys.length > 0 && keys.every((key) => key === 'lyricCues')) return '歌詞の時刻を直す'
  if (keys.length > 0 && keys.every((key) => LYRIC_FIELDS.has(key))) return '歌詞を直す'
  if (keys.length > 0 && keys.every((key) => STYLE_FIELDS.has(key))) return '作品の方針を直す'
  if (keys.length === 1 && keys[0] === 'name') return '作品名を変える'
  return '作品の設定を直す'
}

export const recordProjectEdit = async (
  recorder: EditRepositories['editBatches'],
  projectId: Project['id'],
  entry: EditBatchProjectEntry | null,
): Promise<void> => {
  if (entry === null) return
  await recorder.create({
    projectId,
    kind: 'project_edit',
    summary: projectEditSummary(entry),
    entries: [],
    projectEntry: entry,
  })
}
