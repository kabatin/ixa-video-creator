import { z } from 'zod'
import { seg } from '../api-client.js'
import { defineTool, Id, jsonResult, ToolInputError } from '../tool-def.js'

/** 直しの履歴と取り消し（画面の ⌘Z と同じ記録）。 */

const WireEditBatch = z.object({
  id: z.string(),
  kind: z.string(),
  summary: z.string(),
  undoneAt: z.string().nullable(),
  createdAt: z.string(),
  canUndo: z.boolean(),
})

export const listEditsTool = defineTool({
  name: 'list_edits',
  risk: 'read',
  description: 'Recent edits of the project, newest first, with whether each can still be undone. Undo one with undo {editBatchId}.',
  input: z.object({ projectId: Id, limit: z.number().int().min(1).max(50).default(10) }),
  handler: async ({ projectId, limit }, { api }) => {
    const batches = await api.get(`/projects/${seg(projectId)}/edit-batches`, z.array(WireEditBatch))
    return jsonResult({
      edits: batches.slice(0, limit).map((b) => ({
        editBatchId: b.id,
        summary: b.summary,
        kind: b.kind,
        createdAt: b.createdAt,
        ...(b.undoneAt === null ? {} : { undoneAt: b.undoneAt }),
        canUndo: b.canUndo,
      })),
    })
  },
})

/** 戻せなかった分は欄ごとに理由つき。空の欄は返さない（文脈を食わない）。 */
const UndoResult = z.object({ batch: WireEditBatch }).passthrough()

const nonEmpty = (record: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(record).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && v.length === 0)),
  )

export const undoTool = defineTool({
  name: 'undo',
  risk: 'destructive',
  description:
    'Undo one recorded edit (default: the newest one that can be undone; see list_edits). ' +
    'Returns what was restored and what could not be, with reasons.',
  input: z.object({ projectId: Id, editBatchId: Id.optional() }),
  handler: async ({ projectId, editBatchId }, { api }) => {
    const base = `/projects/${seg(projectId)}/edit-batches`
    const target =
      editBatchId ?? (await api.get(base, z.array(WireEditBatch))).find((b) => b.canUndo)?.id
    if (target === undefined) throw new ToolInputError('取り消せる直しがありません')
    const { batch, ...rest } = await api.post(`${base}/${seg(target)}/undo`, undefined, UndoResult)
    return jsonResult({ editBatchId: batch.id, summary: batch.summary, ...nonEmpty(rest) })
  },
})
