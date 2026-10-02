import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ImageJobRepository, ProjectRepository, ShotReferenceRepository, ShotRepository } from '@ixa/db'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  type ImageGenerationJob,
  type ImageGenerationJobId,
  type ModelId,
  type ProjectEventPublisher,
  type ProviderId,
  type Shot,
} from '@ixa/domain'
import { manualStartFrameOf } from '@ixa/generation'
import type { Logger } from 'pino'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { startImageJob, type ImageJobQueue } from './image-job-start.js'

/**
 * 絵コンテの画像を作る口（ADR-0029）。**ジョブを 1 行作って image キューへ入れるだけ。** 作るのは worker。
 * 1 枚 70 秒ほどかかる（Codex CLI）ので、待たずに 202 を返し、出来上がりは出来事で知らせる。
 */

/** キュー名は apps/worker/src/queues.ts の QUEUE_NAMES と一致させること（apps 同士は import できない）。 */
export const IMAGE_QUEUE_NAME = 'image'

/** キューの口は `image-job-start.ts` が持つ（キャラクターシートと共有）。 */
export type { ImageJobQueue } from './image-job-start.js'

export type StartFrameGenerateRoutesDeps = {
  readonly shots: Pick<ShotRepository, 'findById' | 'findByProject'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shotReferences: Pick<ShotReferenceRepository, 'findByShot'>
  readonly imageJobs: ImageJobRepository
  readonly imageQueue: ImageJobQueue
  /**
   * どの口で作るか。**作るたびに呼ぶ**（画面の「使う AI」で選び直したら次の 1 枚から効く。ADR-0032）。
   * ジョブに記録し、worker はジョブに書かれた口で作る。
   */
  readonly imageModel: () => Promise<{ readonly providerId: ProviderId; readonly modelId: ModelId }>
  readonly events: ProjectEventPublisher
  readonly logger: Logger
}

export const DRAWING_MESSAGE = 'この Shot の絵コンテの画像を作っています。できあがるまで待ってください。'
export const FOREIGN_SHOT_MESSAGE = 'この Project の Shot ではありません'
/** 一度に頼める数。Codex は 1 枚 70 秒ほどなので、100 枚で 2 時間になる。 */
export const MAX_BULK_START_FRAMES = 100

const ShotParams = z.object({ id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const StartedData = z.object({ jobId: ImageGenerationJobIdSchema }).openapi('StartFrameGenerateStarted')
const BulkBody = z
  .object({
    shotIds: z.array(ShotIdSchema).min(1).max(MAX_BULK_START_FRAMES),
    /** 既定は true（絵がもうある Shot は飛ばす）。作り直すときだけ false。 */
    onlyMissing: z.boolean().default(true),
  })
  .openapi('StartFramesGenerateInput')
const BulkData = z
  .object({
    jobIds: z.array(ImageGenerationJobIdSchema),
    skipped: z.object({ drawing: z.number().int(), hasFrame: z.number().int() }),
  })
  .openapi('StartFramesGenerateStarted')

const generateRoute = createRoute({
  method: 'post',
  path: '/shots/{id}/start-frame/generate',
  tags: ['shots'],
  summary: 'Shot の絵コンテの画像（最初のフレーム）を作る',
  request: { params: ShotParams },
  responses: {
    202: { description: '作り始めた', content: { 'application/json': { schema: successResponse(StartedData) } } },
    404: errorContent('Shot が存在しない'),
    409: errorContent('その Shot の絵を作っている'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const bulkRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/start-frames/generate',
  tags: ['shots'],
  summary: '複数の Shot の絵コンテの画像をまとめて作る',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: BulkBody } } },
  },
  responses: {
    202: { description: '作り始めた', content: { 'application/json': { schema: successResponse(BulkData) } } },
    404: errorContent('Project が存在しない'),
    422: errorContent('別の Project の Shot が混じっている / 入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

/** 最初のフレームのジョブを始める（キャラクターシートと同じ道。`image-job-start.ts`）。 */
const start = async (deps: StartFrameGenerateRoutesDeps, shot: Shot): Promise<ImageGenerationJob> =>
  startImageJob(deps, { kind: 'start_frame', projectId: shot.projectId, shotId: shot.id, ...(await deps.imageModel()) })

export const shotStartFrameGenerateRoutes = (deps: StartFrameGenerateRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(generateRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      if ((await deps.imageJobs.findActiveByShot(shot.id)) !== null) return c.json(fail(DRAWING_MESSAGE), 409)
      const job = await start(deps, shot)
      return c.json(ok({ jobId: job.id }), 202)
    })
    .openapi(bulkRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { shotIds, onlyMissing } = c.req.valid('json')
      const shots = new Map((await deps.shots.findByProject(projectId)).map((shot) => [shot.id, shot] as const))
      // 1 件でも混じれば何もしない（途中まで頼んで止まると、どこまで頼んだか分からない）。
      if (shotIds.some((id) => !shots.has(id))) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { shotIds: [FOREIGN_SHOT_MESSAGE] }), 422)
      }

      const jobIds: ImageGenerationJobId[] = []
      const skipped = { drawing: 0, hasFrame: 0 }
      for (const shot of [...new Set(shotIds)].flatMap((id) => shots.get(id) ?? [])) {
        if ((await deps.imageJobs.findActiveByShot(shot.id)) !== null) {
          skipped.drawing += 1
        } else if (onlyMissing && (await manualStartFrameOf(deps.shotReferences, shot.id)) !== null) {
          skipped.hasFrame += 1
        } else {
          jobIds.push((await start(deps, shot)).id)
        }
      }
      return c.json(ok({ jobIds, skipped }), 202)
    })
