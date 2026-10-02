import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  GenerationJobId as GenerationJobIdSchema,
  ShotId as ShotIdSchema,
  shotStatusAfterCancel,
  type GenerationJob,
  type Shot,
} from '@ixa/domain'
import type { ProviderJobHandle } from '@ixa/provider-core'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { ShotResponse, publishShotStatus, toShotResponse, type ShotRoutesDeps } from './shots.js'

/**
 * 生成をやめる（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい」）。
 *
 * 生成先には止める口がある（`VideoProvider.cancel`）が、API と画面に口が無かった。
 * **やめたことは生成先に届かなくても確定する。** ジョブの行を先に取り消しにするので、
 * worker は次に読み直したときに止まり、止めた後に届いた結果を Take にしない（worker の `processor.ts`）。
 */

export type GenerationCancelDeps = Pick<
  ShotRoutesDeps,
  'shots' | 'takes' | 'generationJobs' | 'registry' | 'events' | 'logger'
>

const CancelData = z
  .object({
    /** 取り消した生成。動いている生成が無ければ空。 */
    cancelledJobIds: z.array(GenerationJobIdSchema),
    shot: ShotResponse,
  })
  .openapi('CancelGenerationsResult')

const cancelRoute = createRoute({
  method: 'post',
  path: '/shots/{id}/generations/cancel',
  tags: ['shots'],
  summary: 'その Shot で動いている生成（順番待ち・作成中）をすべてやめる',
  request: { params: z.object({ id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: {
      description: '取り消した生成と、決め直した Shot',
      content: { 'application/json': { schema: successResponse(CancelData) } },
    },
    404: errorContent('Shot が存在しない'),
  },
})

const isActive = (job: GenerationJob): boolean => job.status === 'queued' || job.status === 'running'

/**
 * 生成先へ止めてと頼む。**届かなくても投げない**（取り消しはもう確定している）。
 * 届かなかったことはログに残す。生成先へまだ送っていない（順番待ち）なら頼む相手が無い。
 */
const stopAtProvider = async (deps: GenerationCancelDeps, job: GenerationJob): Promise<void> => {
  if (job.providerJobRef === null || job.resolvedModel === null) return
  try {
    const model = deps.registry.findModel(job.resolvedModel)
    const handle: ProviderJobHandle = {
      providerId: model.providerId,
      modelId: model.id,
      ref: job.providerJobRef,
      submittedAt: job.startedAt ?? job.queuedAt,
    }
    await deps.registry.providerFor(model.id).cancel(handle)
  } catch (error) {
    deps.logger.warn(
      { err: error, jobId: job.id, modelId: job.resolvedModel },
      '生成先へ止めてと頼めませんでした。取り消しは確定しています',
    )
  }
}

/** 取り消したことを画面へ流す。**落ちても取り消しは巻き戻さない**（`ProjectEventPublisher` の約束）。 */
const publishCancelled = async (
  deps: GenerationCancelDeps,
  shot: Shot,
  job: GenerationJob,
  at: Date,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'generation_job.status',
      projectId: shot.projectId,
      shotId: shot.id,
      jobId: job.id,
      status: 'cancelled',
      takeId: null,
      error: null,
      at: at.toISOString(),
    })
  } catch (error) {
    deps.logger.warn({ err: error, jobId: job.id }, '生成の取り消しを配信できませんでした')
  }
}

/** その Shot で動いている生成をすべてやめ、Shot の状態を決め直す。 */
export const cancelShotGenerations = async (
  deps: GenerationCancelDeps,
  shot: Shot,
  now: Date,
): Promise<{ readonly cancelled: readonly GenerationJob[]; readonly shot: Shot }> => {
  const active = (await deps.generationJobs.findByShot(shot.id)).filter(isActive)
  if (active.length === 0) return { cancelled: [], shot }

  const cancelled = await Promise.all(
    active.map((job) => deps.generationJobs.update(job.id, { status: 'cancelled', finishedAt: now })),
  )
  await Promise.all(active.map((job) => stopAtProvider(deps, job)))
  for (const job of cancelled) await publishCancelled(deps, shot, job, now)

  const [takes, latest] = await Promise.all([
    deps.takes.findByShot(shot.id),
    deps.shots.findById(shot.id),
  ])
  const next = shotStatusAfterCancel({
    // 採用は生成の最中にも変わりうる。頭で読んだ値ではなく読み直した値を使う。
    hasSelectedTake: (latest ?? shot).selectedTakeId !== null,
    hasTakes: takes.length > 0,
  })
  const moved = await deps.shots.updateStatus(shot.id, next)
  await publishShotStatus(deps, moved)
  return { cancelled, shot: moved }
}

export const generationCancelRoutes = (deps: GenerationCancelDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(cancelRoute, async (c) => {
    const shot = await deps.shots.findById(c.req.valid('param').id)
    if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const result = await cancelShotGenerations(deps, shot, new Date())
    return c.json(
      ok({
        cancelledJobIds: result.cancelled.map((job) => job.id),
        shot: toShotResponse(result.shot),
      }),
      200,
    )
  })
