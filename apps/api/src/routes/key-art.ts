import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ImageCheckRepository, ImageJobRepository, ProjectRepository } from '@ixa/db'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ImageGenerationJobStatus as ImageGenerationJobStatusSchema,
  KEY_ART_MAX_COUNT,
  KeyArtInstruction,
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  type ImageCheck,
  type ImageGenerationJob,
  type ImageGenerationJobId,
  type ModelId,
  type ProjectId,
  type ProviderId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { ImageCheckSummary, toImageCheckSummary } from './image-check-wire.js'
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
  /** 作った絵のチェック（ADR-0055）。候補に印を付ける。 */
  readonly imageChecks: Pick<ImageCheckRepository, 'findByJobIds'>
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

const StartedData = z
  .object({
    /** 積めたジョブ。途中で積めなくなっても、そこまでの分は返す（描き始めているので隠さない）。 */
    jobIds: z.array(ImageGenerationJobIdSchema),
    /** 積めなかった分の理由（利用者にそのまま見せる文）。全部積めたら空。 */
    failed: z.array(z.object({ message: z.string() })),
  })
  .openapi('KeyArtGenerateStarted')

const ENQUEUE_FAILED_MESSAGE = '残りの絵を描く順番に入れられませんでした。もう一度押してください。'

type Started = { readonly jobIds: readonly ImageGenerationJobId[]; readonly failed: readonly { readonly message: string }[] }

/**
 * 1 枚ずつ積む（順番どおりに描かれる）。**途中で積めなくなったらそこで止め、積めた分を返す。**
 * 例外にすると 1 枚目はもう描き始めているのに、画面と MCP はその ID を知らないまま待てなくなる。
 * 1 枚も積めなければ投げる（500）。
 */
const startAll = async (
  deps: KeyArtRoutesDeps,
  projectId: ProjectId,
  count: number,
  instruction: string | null,
): Promise<Started> => {
  let jobIds: readonly ImageGenerationJobId[] = []
  for (let index = 0; index < count; index += 1) {
    try {
      const job = await startImageJob(deps, { kind: 'key_art', projectId, instruction, ...(await deps.imageModel()) })
      jobIds = [...jobIds, job.id]
    } catch (error) {
      if (jobIds.length === 0) throw error
      deps.logger.error({ projectId, queued: jobIds.length, count, err: error }, 'キーアートの残りを積めませんでした')
      return { jobIds, failed: [{ message: ENQUEUE_FAILED_MESSAGE }] }
    }
  }
  return { jobIds, failed: [] }
}

export const KeyArtJobResponse = z
  .object({
    id: ImageGenerationJobIdSchema,
    status: ImageGenerationJobStatusSchema,
    instruction: z.string().nullable(),
    /** できた絵。成功したときだけ。 */
    mediaAssetId: MediaAssetIdSchema.nullable(),
    /** 失敗したときの理由（利用者にそのまま見せる文）。 */
    error: z.string().nullable(),
    /** 作った絵のチェックの結果（ADR-0055）。まだ見ていなければ null。 */
    check: ImageCheckSummary.nullable(),
    queuedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('KeyArtJob')
export type KeyArtJobResponse = z.infer<typeof KeyArtJobResponse>

export const toKeyArtJobResponse = (job: ImageGenerationJob, check: ImageCheck | null = null): KeyArtJobResponse => ({
  id: job.id,
  status: job.status,
  instruction: job.instruction,
  mediaAssetId: job.mediaAssetId,
  error: job.error?.message ?? null,
  check: toImageCheckSummary(check),
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
      const started = await startAll(deps, project.id, count, instruction ?? null)
      return c.json(ok({ jobIds: [...started.jobIds], failed: [...started.failed] }), 202)
    })
    .openapi(listRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const jobs = await deps.imageJobs.findKeyArtByProject(project.id)
      const checks = await deps.imageChecks.findByJobIds(jobs.map((job) => job.id))
      const checkOf = (job: ImageGenerationJob) => checks.find((check) => check.imageJobId === job.id) ?? null
      return c.json(okList(jobs.map((job) => toKeyArtJobResponse(job, checkOf(job)))), 200)
    })
