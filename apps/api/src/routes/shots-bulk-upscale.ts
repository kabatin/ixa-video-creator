import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  UpscaleJobId as UpscaleJobIdSchema,
  type ProjectId,
  type ShotId,
  type UpscaleJob,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { MAX_BULK_SHOT_IDS } from './shots-bulk.js'
import { MISSING_TAKE_REASON, NO_SELECTED_TAKE_REASON } from './shots-bulk-final.js'
import { resolveShot } from './shots-bulk-plan.js'
import {
  UPSCALE_UNSUPPORTED_MESSAGE,
  enqueueUpscale,
  upscaleBlockerFor,
  type TakeUpscaleRoutesDeps,
} from './take-upscale.js'

/**
 * 選んだ Shot の**採用中の** Take を、まとめて解像度を上げる（ADR-0044）。
 *
 * 1 本ずつ Take のメニューから押す形しか無く、38 本を 1 本ずつ頼んだ（制作者 2026-10-16
 * 「一括メニューで、まとめて高画質化が出ない」）。
 *
 * **判定と投入は 1 本ずつの口と同じ関数を通る**（`take-upscale.ts`。規則を写さない。L-016）。
 * 「本番で作り直す」と同じく、押す前に下見（`dryRun`）で本数と飛ばすものを見せる。
 * **飛ばした Shot は理由つきで返す**（L-015）。
 */

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const BulkUpscaleBody = z
  .object({
    shotIds: z.array(ShotIdSchema).min(1).max(MAX_BULK_SHOT_IDS),
    /** 押す前の下見。同じ判定を投入の手前で止める。 */
    dryRun: z.boolean().default(false),
  })
  .openapi('BulkUpscaleInput')

const BulkUpscaleData = z
  .object({
    results: z.array(
      z.discriminatedUnion('ok', [
        z.object({
          shotId: ShotIdSchema,
          ok: z.literal(true),
          /** 下見のときは null。積んだときだけ入る。 */
          jobId: UpscaleJobIdSchema.nullable(),
        }),
        z.object({ shotId: ShotIdSchema, ok: z.literal(false), reason: z.string() }),
      ]),
    ),
    /** 積んだ本数。下見なら 0。 */
    enqueuedCount: z.number().int().nonnegative(),
    dryRun: z.boolean(),
  })
  .openapi('BulkUpscaleResult')

const bulkUpscaleRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/shots/bulk/upscale',
  tags: ['shots'],
  summary: '選んだ Shot の採用 Take を、まとめて解像度を上げる',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: BulkUpscaleBody } } },
  },
  responses: {
    200: {
      description: '下見（1 件も積んでいない）',
      content: { 'application/json': { schema: successResponse(BulkUpscaleData) } },
    },
    202: {
      description: '1 件ずつの結果',
      content: { 'application/json': { schema: successResponse(BulkUpscaleData) } },
    },
    404: errorContent('Project が存在しない'),
    422: errorContent('この環境では上げられない（1 件も積んでいない）'),
  },
})

type Verdict =
  | { readonly shotId: ShotId; readonly ok: true; readonly jobId: UpscaleJob['id'] | null }
  | { readonly shotId: ShotId; readonly ok: false; readonly reason: string }

/** 1 件ぶん。判定して、下見でなければ積む。積んだ仕事も返す（次の判定で「上げている最中」に数える）。 */
const upscaleOne = async (
  deps: TakeUpscaleRoutesDeps & { readonly upscaler: NonNullable<TakeUpscaleRoutesDeps['upscaler']> },
  projectId: ProjectId,
  shotId: ShotId,
  active: readonly UpscaleJob[],
  dryRun: boolean,
): Promise<{ readonly verdict: Verdict; readonly job?: UpscaleJob }> => {
  const resolved = await resolveShot(deps, projectId, shotId)
  if (!('shot' in resolved)) return { verdict: { shotId, ok: false, reason: resolved.reason } }
  const { shot } = resolved
  if (shot.selectedTakeId === null) {
    return { verdict: { shotId, ok: false, reason: NO_SELECTED_TAKE_REASON } }
  }
  const take = await deps.takes.findById(shot.selectedTakeId)
  if (take === null) return { verdict: { shotId, ok: false, reason: MISSING_TAKE_REASON } }

  const blocker = await upscaleBlockerFor(deps, take, active)
  if (blocker !== null) return { verdict: { shotId, ok: false, reason: blocker } }
  if (dryRun) return { verdict: { shotId, ok: true, jobId: null } }

  const job = await enqueueUpscale(deps, deps.upscaler, shot, take)
  return { verdict: { shotId, ok: true, jobId: job.id }, job }
}

export const shotBulkUpscaleRoutes = (deps: TakeUpscaleRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(bulkUpscaleRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) {
      return c.json(fail(NOT_FOUND_MESSAGE), 404)
    }
    const { shotIds, dryRun } = c.req.valid('json')

    /** **対応はサーバに 1 回だけ訊く。** 対応していなければ 1 件も積まない（1 本ずつの口と同じ）。 */
    const { upscaler } = deps
    if (upscaler === null || !(await upscaler.available())) {
      return c.json(fail(UPSCALE_UNSUPPORTED_MESSAGE), 422)
    }

    /**
     * **1 件ずつ順に。** 積んだ仕事を次の判定の「上げている最中」に足す
     * （同じ Take が選択に 2 回入っても二重に積まない）。
     */
    let active = await deps.upscaleJobs.findActiveByProject(projectId)
    let results: readonly Verdict[] = []
    for (const shotId of shotIds) {
      const one = await upscaleOne({ ...deps, upscaler }, projectId, shotId, active, dryRun)
      results = [...results, one.verdict]
      if (one.job !== undefined) active = [...active, one.job]
    }

    const body = ok({
      results: [...results],
      enqueuedCount: results.filter((entry) => entry.ok && entry.jobId !== null).length,
      dryRun,
    })
    return dryRun ? c.json(body, 200) : c.json(body, 202)
  })
