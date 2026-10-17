import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ImageJobRepository, ProjectRepository } from '@ixa/db'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ImageGenerationJobStatus as ImageGenerationJobStatusSchema,
  KEY_ART_MAX_COUNT,
  KeyArtInstruction,
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  type ImageGenerationJob,
  type ModelId,
  type ProviderId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { sequentially } from '../sequentially.js'
import { startImageJob, type ImageJobStartDeps } from './image-job-start.js'

/**
 * サムネイルの背景を AI に描かせる口（キーアート。ADR-0051）。
 *
 * **ジョブを枚数ぶん作って image キューへ入れるだけ。** 作るのは worker（Codex は 1 度に 1 枚なので、
 * 絵コンテの画像・キャラクターシートと同じ順番待ち）。状態の知らせは既存の `image_job.status`
 * （Shot もキャラクターも null）。画面と MCP は一覧を引き直して候補を出す。
 */

export type KeyArtRoutesDeps = ImageJobStartDeps & {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly imageJobs: Pick<ImageJobRepository, 'create' | 'markFailed' | 'findKeyArtByProject'>
  /** どの口で作るか。**作るたびに呼ぶ**（「使う AI」の画像の欄。ADR-0032）。 */
  readonly imageModel: () => Promise<{ readonly providerId: ProviderId; readonly modelId: ModelId }>
}

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const GenerateBody = z
  .object({
    /** 何枚描かせるか。既定は 1 枚。 */
    count: z.number().int().min(1).max(KEY_ART_MAX_COUNT).default(1),
    /** 制作者の自由な指示。空なら指示なし。 */
    instruction: KeyArtInstruction.optional(),
  })
  .openapi('KeyArtGenerateInput')

const StartedData = z.object({ jobIds: z.array(ImageGenerationJobIdSchema) }).openapi('KeyArtGenerateStarted')

export const KeyArtJobResponse = z
  .object({
    id: ImageGenerationJobIdSchema,
    status: ImageGenerationJobStatusSchema,
    instruction: z.string().nullable(),
    /** できた絵。成功したときだけ。 */
    mediaAssetId: MediaAssetIdSchema.nullable(),
    /** 失敗したときの理由（利用者にそのまま見せる文）。 */
    error: z.string().nullable(),
    queuedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('KeyArtJob')
export type KeyArtJobResponse = z.infer<typeof KeyArtJobResponse>

export const toKeyArtJobResponse = (job: ImageGenerationJob): KeyArtJobResponse => ({
  id: job.id,
  status: job.status,
  instruction: job.instruction,
  mediaAssetId: job.mediaAssetId,
  error: job.error?.message ?? null,
  queuedAt: job.queuedAt.toISOString(),
  finishedAt: job.finishedAt === null ? null : job.finishedAt.toISOString(),
})

const generateRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/key-art/generate',
  tags: ['thumbnails'],
  summary: 'サムネイルの背景（キーアート）を AI に描かせ始める',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: GenerateBody } } },
  },
  responses: {
    202: { description: '描き始めた', content: { 'application/json': { schema: successResponse(StartedData) } } },
    404: errorContent('Project が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const listRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/key-art',
  tags: ['thumbnails'],
  summary: 'Project のキーアートのジョブ（新しい順）',
  request: { params: ProjectParams },
  responses: {
    200: { description: 'キーアートのジョブ', content: { 'application/json': { schema: listResponse(KeyArtJobResponse) } } },
    404: errorContent('Project が存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

export const keyArtRoutes = (deps: KeyArtRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(generateRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { count, instruction } = c.req.valid('json')
      // 1 枚ずつ積む（順番どおりに描かれ、途中で積めなくなったらそこで止まる）。
      const jobs = await sequentially(
        Array.from({ length: count }, (_unused, index) => index),
        async () =>
          startImageJob(deps, {
            kind: 'key_art',
            projectId: project.id,
            instruction: instruction ?? null,
            ...(await deps.imageModel()),
          }),
      )
      return c.json(ok({ jobIds: jobs.map((job) => job.id) }), 202)
    })
    .openapi(listRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const jobs = await deps.imageJobs.findKeyArtByProject(project.id)
      return c.json(okList(jobs.map(toKeyArtJobResponse)), 200)
    })
