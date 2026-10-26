import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  DUB_GENERATING_REASON,
  DUB_IN_PROGRESS_REASON,
  DubJob as DubJobSchema,
  DubJobId as DubJobIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  dubBlocker,
  type DubJob,
  type Shot,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import type { DubRoutesDeps } from '../dub/deps.js'

/**
 * 声の差し替え（ADR-0062 段 5b）。**ジョブを 1 行作って dub キューへ入れるだけ。** 差し替えるのは worker。
 * 元は**積んだときの採用中の Take**。差し替えられない理由は domain の `dubBlocker`（画面と同じもの）。
 */

export const DubJobResponse = DubJobSchema.omit({ queuedAt: true, startedAt: true, finishedAt: true })
  .extend({
    queuedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('DubJob')
export type DubJobResponse = z.infer<typeof DubJobResponse>

export const toDubJobResponse = (job: DubJob): DubJobResponse => ({
  ...job,
  queuedAt: job.queuedAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null,
  finishedAt: job.finishedAt?.toISOString() ?? null,
})

const ShotDubState = z
  .object({
    /** 差し替えられない理由（押せないボタンの理由）。差し替えられれば null。 */
    blocker: z.string().nullable(),
    /** この Shot の最後の差し替え（進み具合・失敗の理由・結果の表）。 */
    latestJob: DubJobResponse.nullable(),
  })
  .openapi('ShotDubState')

const ShotParams = z.object({ shotId: ShotIdSchema.openapi({ param: { name: 'shotId', in: 'path' } }) })
const JobParams = z.object({ id: DubJobIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } })

const startRoute = createRoute({
  method: 'post', path: '/shots/{shotId}/dub', tags: ['shots'],
  summary: '採用中の Take の声を、キャラクターのセリフの声で読み直して差し替える（新しい Take になる）',
  request: { params: ShotParams },
  responses: {
    202: json('積んだ差し替え', successResponse(DubJobResponse)),
    404: errorContent('Shot が存在しない'),
    409: errorContent('差し替えている最中・動画を作っている最中'),
    422: errorContent('差し替えられない（セリフが無い・採用 Take が無い・音が無い）'),
  },
})
const stateRoute = createRoute({
  method: 'get', path: '/shots/{shotId}/dub', tags: ['shots'],
  summary: 'この Shot を差し替えられるかと、最後の差し替え',
  request: { params: ShotParams },
  responses: { 200: json('差し替えの様子', successResponse(ShotDubState)), 404: errorContent('Shot が存在しない') },
})
const getRoute = createRoute({
  method: 'get', path: '/dub-jobs/{id}', tags: ['shots'],
  summary: '差し替えのジョブ',
  request: { params: JobParams },
  responses: { 200: json('差し替えのジョブ', successResponse(DubJobResponse)), 404: errorContent('ジョブが存在しない') },
})
const cancelRoute = createRoute({
  method: 'post', path: '/dub-jobs/{id}/cancel', tags: ['shots'],
  summary: '差し替えを止める（待っている・動いているときだけ。出来た Take は残る）',
  request: { params: JobParams },
  responses: { 200: json('止めた（または今の）ジョブ', successResponse(DubJobResponse)), 404: errorContent('ジョブが存在しない') },
})
const activeRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/dubs/active', tags: ['shots'],
  summary: '作品で動いている差し替え（待っている・動いている）',
  request: { params: ProjectParams },
  responses: { 200: json('動いている差し替え', successResponse(z.array(DubJobResponse))), 404: errorContent('作品が存在しない') },
})

type Deps = Pick<DubRoutesDeps, 'shots' | 'takes' | 'mediaAssets' | 'dubJobs' | 'dubQueue' | 'projects' | 'logger'>

/** 採用 Take の音があるか。測っていなければ null（worker が確かめる）。 */
const sourceHasAudio = async (deps: Deps, shot: Shot): Promise<boolean | null> => {
  if (shot.selectedTakeId === null) return null
  const take = await deps.takes.findById(shot.selectedTakeId)
  const asset = take === null ? null : await deps.mediaAssets.findById(take.mediaAssetId)
  return asset?.probe?.hasAudio ?? null
}

/** その Shot を差し替えられない理由、または null。 */
export const dubBlockerFor = async (deps: Deps, shot: Shot): Promise<string | null> => {
  const active = (await deps.dubJobs.findActiveByProject(shot.projectId)).some((job) => job.shotId === shot.id)
  return dubBlocker({ shot, sourceHasAudio: await sourceHasAudio(deps, shot), active })
}

const CONFLICT_REASONS: readonly string[] = [DUB_IN_PROGRESS_REASON, DUB_GENERATING_REASON]

export const shotDubRoutes = (deps: Deps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(startRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').shotId)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const blocker = await dubBlockerFor(deps, shot)
      if (blocker !== null) return c.json(fail(blocker), CONFLICT_REASONS.includes(blocker) ? 409 : 422)
      const selected = shot.selectedTakeId
      if (selected === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const job = await deps.dubJobs.create({ projectId: shot.projectId, shotId: shot.id, sourceTakeId: selected })
      try {
        await deps.dubQueue.enqueue(job.id)
      } catch (error) {
        // 入れ損ねたら失敗にしてから投げる（待っているまま残すと、その Shot は二度と差し替えを頼めない）。
        await deps.dubJobs.markFailed(
          job.id,
          { code: 'enqueue_failed', message: '差し替えの順番に入れられませんでした。もう一度押してください', retryable: true },
          0,
        )
        throw new Error('dub キューへ入れられませんでした', { cause: error })
      }
      deps.logger.info({ dubJobId: job.id, shotId: shot.id }, '声の差し替えを積みました')
      return c.json(ok(toDubJobResponse(job)), 202)
    })
    .openapi(stateRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').shotId)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const latest = await deps.dubJobs.findLatestByShot(shot.id)
      return c.json(ok({ blocker: await dubBlockerFor(deps, shot), latestJob: latest === null ? null : toDubJobResponse(latest) }), 200)
    })
    .openapi(getRoute, async (c) => {
      const job = await deps.dubJobs.findById(c.req.valid('param').id)
      if (job === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toDubJobResponse(job)), 200)
    })
    .openapi(cancelRoute, async (c) => {
      const job = await deps.dubJobs.findById(c.req.valid('param').id)
      if (job === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toDubJobResponse(await deps.dubJobs.cancel(job.id))), 200)
    })
    .openapi(activeRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok((await deps.dubJobs.findActiveByProject(projectId)).map(toDubJobResponse)), 200)
    })
