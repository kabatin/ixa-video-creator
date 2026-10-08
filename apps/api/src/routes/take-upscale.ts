import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, ShotRepository, TakeRepository, UpscaleJobRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  UpscaleJobId as UpscaleJobIdSchema,
  UpscaleJobStatus as UpscaleJobStatusSchema,
  upscaleBlocker,
  type ProjectEventPublisher,
  type UpscaleJob,
  type UpscaleJobId,
} from '@ixa/domain'
import type { VideoUpscaler } from '@ixa/provider-core'
import type { Logger } from 'pino'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 出来上がった Take の解像度を上げる（ADR-0044）。
 *
 * **ジョブを 1 行作って upscale キューへ入れるだけ。** 上げるのは worker。
 * 絵コンテの画像（`image-job-start.ts`）と同じ形で、仕事の種類だけが違う。
 */

export const UPSCALE_UNSUPPORTED_MESSAGE =
  'この環境では解像度を上げられません（手元の生成サーバが対応していません）。'

/**
 * キューの名前。**`apps/worker/src/queues.ts` の `QUEUE_NAMES.upscale` と一致させること。**
 * apps 同士を import できないので、文字列で合わせるしかない。
 */
export const UPSCALE_QUEUE_NAME = 'upscale'

export type UpscaleJobQueue = { readonly enqueue: (upscaleJobId: UpscaleJobId) => Promise<void> }

export type TakeUpscaleRoutesDeps = {
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly takes: Pick<TakeRepository, 'findById' | 'findByShot'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly upscaleJobs: Pick<
    UpscaleJobRepository,
    'create' | 'markFailed' | 'findActiveByProject' | 'cancelActive'
  >
  readonly upscaleQueue: UpscaleJobQueue
  /**
   * 解像度を上げる口。**この機械に無ければ null。**
   * あっても、サーバが対応しているかは毎回訊く（古い版へ投げない）。
   */
  readonly upscaler: VideoUpscaler | null
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}

const UpscaleJobResponse = z
  .object({
    id: UpscaleJobIdSchema,
    shotId: ShotIdSchema,
    sourceTakeId: TakeIdSchema,
    status: UpscaleJobStatusSchema,
    /** 走っている間の見込み（秒）。投入するまでは null。 */
    estimateSeconds: z.number().nonnegative().nullable(),
  })
  .openapi('UpscaleJob')

const toResponse = (job: UpscaleJob) => ({
  id: job.id,
  shotId: job.shotId,
  sourceTakeId: job.sourceTakeId,
  status: job.status,
  estimateSeconds: job.estimateSeconds,
})

/** 状態が変わったことを流す。**通知は上乗せ。** 落ちても頼んだことは取り消さない。 */
const publishUpscaleJob = async (
  deps: Pick<TakeUpscaleRoutesDeps, 'events' | 'logger'>,
  job: UpscaleJob,
  projectId: string,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'upscale_job.status',
      projectId: ProjectIdSchema.parse(projectId),
      at: new Date().toISOString(),
      shotId: job.shotId,
      jobId: job.id,
      status: job.status,
      takeId: job.takeId,
      estimateSeconds: job.estimateSeconds,
      error: job.error?.message ?? null,
    })
  } catch (error) {
    deps.logger.warn({ upscaleJobId: job.id, err: error }, '出来事を流せませんでした')
  }
}

const upscaleRoute = createRoute({
  method: 'post',
  path: '/shots/{shotId}/takes/{takeId}/upscale',
  tags: ['takes'],
  summary: 'その Take の解像度を上げる（元の Take は残る）',
  request: {
    params: z.object({
      shotId: ShotIdSchema.openapi({ param: { name: 'shotId', in: 'path' } }),
      takeId: TakeIdSchema.openapi({ param: { name: 'takeId', in: 'path' } }),
    }),
  },
  responses: {
    202: {
      description: '順番に入れた',
      content: { 'application/json': { schema: successResponse(UpscaleJobResponse) } },
    },
    404: errorContent('Shot か Take が存在しない'),
    422: errorContent('この環境では上げられない、または上げる必要がない'),
  },
})

/**
 * 解像度を上げられる環境か。**画面が押せる／押せないを決めるために引く。**
 * 押しても必ず断られる操作を、押せる形で出さないため。
 */
const supportRoute = createRoute({
  method: 'get',
  path: '/upscale/support',
  tags: ['takes'],
  summary: 'この環境で解像度を上げられるか',
  responses: {
    200: {
      description: '対応の有無',
      content: {
        'application/json': {
          schema: successResponse(z.object({ supported: z.boolean() })),
        },
      },
    },
  },
})

const cancelRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/upscales/cancel',
  tags: ['takes'],
  summary: '待っている・上げている最中の仕事をすべてやめる',
  request: {
    params: z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) }),
  },
  responses: {
    200: {
      description: '取り消した仕事',
      content: {
        'application/json': {
          schema: successResponse(z.object({ cancelledJobIds: z.array(UpscaleJobIdSchema) })),
        },
      },
    },
    404: errorContent('Project が存在しない'),
  },
})

export const takeUpscaleRoutes = (deps: TakeUpscaleRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(upscaleRoute, async (c) => {
      const { shotId, takeId } = c.req.valid('param')
      const shot = await deps.shots.findById(shotId)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const take = await deps.takes.findById(takeId)
      // 別の Shot の Take を上げると、出来たものが別の Shot にぶら下がる。
      if (take === null || take.shotId !== shot.id) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      /**
       * **対応はサーバに訊く。** 対応していない版へ投げると、大きな本文を送ってから断られる。
       * この機械に口そのものが無いときも同じ扱い。
       */
      if (deps.upscaler === null || !(await deps.upscaler.available())) {
        return c.json(fail(UPSCALE_UNSUPPORTED_MESSAGE), 422)
      }

      /** 上げられるかの規則は domain に 1 つ（画面も同じものを呼ぶ）。 */
      const [siblings, active] = await Promise.all([
        deps.takes.findByShot(shot.id, { includeHidden: true }),
        deps.upscaleJobs.findActiveByProject(shot.projectId),
      ])
      const blocker = upscaleBlocker({
        take,
        siblings,
        activeSourceTakeIds: active.map((job) => job.sourceTakeId),
      })
      if (blocker !== null) return c.json(fail(blocker), 422)

      const job = await deps.upscaleJobs.create({
        projectId: shot.projectId,
        shotId: shot.id,
        sourceTakeId: take.id,
        providerId: deps.upscaler.providerId,
        modelId: deps.upscaler.modelId,
      })

      /**
       * **入れ損ねたら失敗にしてから投げる。** 待っているまま残すと、その Take は
       * 「上げています」のまま二度と頼めなくなる（`upscaleBlocker` が止めるため）。
       */
      try {
        await deps.upscaleQueue.enqueue(job.id)
      } catch (error) {
        const failed = await deps.upscaleJobs.markFailed(
          job.id,
          {
            code: 'enqueue_failed',
            message: '解像度を上げる順番に入れられませんでした。もう一度押してください。',
            retryable: true,
          },
          null,
        )
        await publishUpscaleJob(deps, failed, shot.projectId)
        throw new Error('upscale キューへ入れられませんでした', { cause: error })
      }

      await publishUpscaleJob(deps, job, shot.projectId)
      return c.json(ok(toResponse(job)), 202)
    })

    .openapi(supportRoute, async (c) => {
      const supported = deps.upscaler !== null && (await deps.upscaler.available())
      return c.json(ok({ supported }), 200)
    })

    .openapi(cancelRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      const cancelled = await deps.upscaleJobs.cancelActive({ projectId })
      for (const job of cancelled) await publishUpscaleJob(deps, job, projectId)
      return c.json(ok({ cancelledJobIds: cancelled.map((job) => job.id) }), 200)
    })
