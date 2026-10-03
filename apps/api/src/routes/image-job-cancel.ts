import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ImageJobRepository, ProjectRepository } from '@ixa/db'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  type ProjectEventPublisher,
} from '@ixa/domain'
import type { Logger } from 'pino'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { publishImageJob } from './image-job-start.js'

/**
 * 絵を作るのを止める（制作者 2026-10-04「いま30個ぐらいキューに入ってる画像生成とめたい」「API追加して、画像生成も
 * 停められるようにしよう」）。動画の「生成をやめる」（`generation-cancel.ts`）の絵版。
 *
 * **止めたことは行を書き換えた時点で確定する。** 待っている絵は worker が拾っても作らない。作っている絵は、worker が
 * 次に見たときに生成先へ止めてと頼んで手を引き、届いた絵で最初のフレームを差し替えない（worker の `image/processor.ts`）。
 */

export type ImageJobCancelDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly imageJobs: Pick<ImageJobRepository, 'cancelActive'>
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}

/** 1 回で指定できる Shot の数。作品の Shot の数を超える指定に意味は無い。 */
const MAX_CANCEL_SHOT_IDS = 500

const CancelBody = z
  .object({
    /** 止める Shot。省略すると作品の全部（キャラクターシートも）。 */
    shotIds: z.array(ShotIdSchema).max(MAX_CANCEL_SHOT_IDS).optional(),
  })
  .openapi('CancelImagesBody')

const CancelData = z
  .object({
    /** 止めた絵のジョブ。待っている・作っている絵が無ければ空。 */
    cancelledJobIds: z.array(ImageGenerationJobIdSchema),
  })
  .openapi('CancelImagesResult')

const cancelRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/images/cancel',
  tags: ['images'],
  summary: '待っている・作っている絵（最初のフレーム・キャラクターシート）を止める',
  request: {
    params: z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) }),
    body: { required: false, content: { 'application/json': { schema: CancelBody } } },
  },
  responses: {
    200: {
      description: '止めた絵のジョブ',
      content: { 'application/json': { schema: successResponse(CancelData) } },
    },
    404: errorContent('作品が存在しない'),
    422: errorContent('入力の検証に失敗した'),
  },
})

export const imageJobCancelRoutes = (deps: ImageJobCancelDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(cancelRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const { shotIds } = c.req.valid('json')
    const cancelled = await deps.imageJobs.cancelActive({ projectId, ...(shotIds === undefined ? {} : { shotIds }) })
    // 画面の「作っています」の印を消す。通知は上乗せで、落ちても止めたことは巻き戻さない（`publishImageJob`）。
    for (const job of cancelled) await publishImageJob(deps, job)
    deps.logger.info({ projectId, count: cancelled.length }, '絵を作るのを止めました')

    return c.json(ok({ cancelledJobIds: cancelled.map((job) => job.id) }), 200)
  })
