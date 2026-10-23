import { ShotCamera } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { bulkResult, WireShot } from '../wire.js'
import { defineTool, Id, jsonResult, ToolInputError } from '../tool-def.js'

/**
 * Shot の組み替え（割る・まとめる・消す・差し込む）。並べ替えは API に口が無いので持たない。
 * 割る・まとめるは Take の無い Shot だけ（API が断る）。
 */

/** 並び順の刻み。API の Shot の order は 1000 刻みで採番する（ARCHITECTURE §19）。 */
const ORDER_STEP = 1000

const DEFAULT_CAMERA = { size: 'medium', angleH: null, angle: null, lensMm: null, movement: null, movementIntensity: null } as const

export const RestructureShotsInput = z.object({
  projectId: Id,
  action: z.enum(['split', 'merge', 'delete', 'insert']),
  shotId: Id.optional().describe('split: the shot to split.'),
  atSec: z.number().min(0).optional().describe('split: timeline position (seconds) of the cut.'),
  shotIds: z.array(Id).min(1).max(200).optional().describe('merge: 2+ adjacent shots (into the first); delete: shots to delete.'),
  afterShotId: Id.optional().describe('insert: place the new shot right after this one. Default: at the end.'),
  code: z.string().trim().min(1).max(40).optional().describe('insert: unique shot code, e.g. "CUT12".'),
  startSec: z.number().min(0).optional().describe('insert'),
  durationSec: z.number().positive().optional().describe('insert'),
  description: z.string().max(4000).optional().describe('insert (Japanese).'),
  mood: z.string().max(500).optional().describe('insert'),
  dialogue: z.string().max(2000).optional().describe('insert: spoken line, if any.'),
  camera: ShotCamera.partial().optional().describe('insert. Default size medium.'),
  locationId: Id.optional().describe('insert'),
})
type RestructureArgs = z.infer<typeof RestructureShotsInput>

const orderedShots = async (api: ApiClient, projectId: string) =>
  [...(await api.get(`/projects/${seg(projectId)}/shots`, z.array(WireShot)))].sort((a, b) => a.order - b.order)

/** 渡した Shot がこの作品のものか（別の作品の Shot を触らない）。 */
const assertInProject = (shots: readonly WireShot[], ids: readonly string[]): void => {
  const known = new Set(shots.map((s) => s.id))
  const foreign = ids.filter((id) => !known.has(id))
  if (foreign.length > 0) throw new ToolInputError(`この作品に無い Shot です: ${foreign.join(', ')}`)
}

/** 差し込む位置の order。直後の Shot との間に隙間が無ければ断る（並べ替えの口が無いので詰め直せない）。 */
export const insertOrder = (shots: readonly WireShot[], afterShotId: string | undefined): number => {
  const last = shots[shots.length - 1]
  if (afterShotId === undefined) return last === undefined ? ORDER_STEP : last.order + ORDER_STEP
  const index = shots.findIndex((s) => s.id === afterShotId)
  const after = shots[index]
  if (after === undefined) throw new ToolInputError('afterShotId がこの作品にありません')
  const next = shots[index + 1]
  if (next === undefined) return after.order + ORDER_STEP
  if (next.order - after.order < 2) throw new ToolInputError('その Shot の直後には差し込む隙間がありません')
  return Math.floor((after.order + next.order) / 2)
}

const split = async (api: ApiClient, args: RestructureArgs) => {
  if (args.shotId === undefined || args.atSec === undefined) throw new ToolInputError('split には shotId と atSec が要ります')
  assertInProject(await orderedShots(api, args.projectId), [args.shotId])
  const result = await api.post(`/shots/${seg(args.shotId)}/split`, { atSec: args.atSec }, z.object({ first: WireShot, second: WireShot }))
  return { first: result.first.id, second: result.second.id }
}

const merge = async (api: ApiClient, args: RestructureArgs) => {
  if (args.shotIds === undefined || args.shotIds.length < 2) throw new ToolInputError('merge には隣り合う shotIds を 2 つ以上')
  assertInProject(await orderedShots(api, args.projectId), args.shotIds)
  const result = await api.post(
    `/projects/${seg(args.projectId)}/shots/merge`,
    { shotIds: args.shotIds },
    z.object({ shot: WireShot, removedShotIds: z.array(z.string()) }),
  )
  return { shotId: result.shot.id, durationSec: result.shot.durationSec, removedShotIds: result.removedShotIds }
}

const WireBulkDelete = z.object({ results: z.array(bulkResult({})), deletedCount: z.number() })

/** 1 本なら取り消しの記録が残る口、2 本以上はまとめて消す口（記録は残らない）。 */
const remove = async (api: ApiClient, args: RestructureArgs) => {
  if (args.shotIds === undefined) throw new ToolInputError('delete には shotIds が要ります')
  assertInProject(await orderedShots(api, args.projectId), args.shotIds)
  const [only] = args.shotIds
  if (args.shotIds.length === 1 && only !== undefined) {
    await api.request('DELETE', `/shots/${seg(only)}`, z.unknown())
    return { deletedCount: 1, undoable: true }
  }
  const bulk = await api.post(`/projects/${seg(args.projectId)}/shots/bulk/delete`, { shotIds: args.shotIds }, WireBulkDelete)
  const failures = bulk.results.flatMap((r) => (r.ok ? [] : [{ shotId: r.shotId, reason: r.reason }]))
  return { deletedCount: bulk.deletedCount, undoable: false, ...(failures.length > 0 ? { failures } : {}) }
}

const insert = async (api: ApiClient, args: RestructureArgs) => {
  if (args.code === undefined || args.startSec === undefined || args.durationSec === undefined) {
    throw new ToolInputError('insert には code・startSec・durationSec が要ります')
  }
  const order = insertOrder(await orderedShots(api, args.projectId), args.afterShotId)
  const created = await api.post(
    `/projects/${seg(args.projectId)}/shots`,
    {
      sequenceId: null,
      order,
      code: args.code,
      startSec: args.startSec,
      durationSec: args.durationSec,
      sourceInSec: 0,
      description: args.description ?? '',
      dialogue: args.dialogue ?? null,
      camera: { ...DEFAULT_CAMERA, ...args.camera },
      mood: args.mood ?? null,
      locationId: args.locationId ?? null,
      sourceType: { type: 'ai_video' },
      status: 'draft',
    },
    WireShot,
  )
  return { shotId: created.id, code: created.code, order: created.order }
}

const ACTIONS = { split, merge, delete: remove, insert } as const

export const restructureShotsTool = defineTool({
  name: 'restructure_shots',
  risk: 'destructive',
  description:
    'Change the shot list: split {shotId, atSec}, merge {shotIds} (adjacent, into the first), delete {shotIds}, ' +
    'insert {code, startSec, durationSec, afterShotId?, description?, dialogue?, ...}. ' +
    'Split and merge only work on shots without takes. Deleting one shot can be undone (undo); deleting several cannot.',
  input: RestructureShotsInput,
  handler: async (args, { api }) => jsonResult({ action: args.action, ...(await ACTIONS[args.action](api, args)) }),
})
