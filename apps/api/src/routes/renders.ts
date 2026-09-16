import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { RenderJobRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  RenderJob as RenderJobSchema,
  RenderJobId as RenderJobIdSchema,
  RenderPreset as RenderPresetSchema,
  RenderScope as RenderScopeSchema,
  ShotId as ShotIdSchema,
  type RenderJob,
  type RenderJobId,
} from '@ixa/domain'
import { validateTimeline, type TimelineIssue } from '@ixa/timeline'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { loadTimelineDocument, type TimelineRoutesDeps } from './timeline.js'

/**
 * レンダリングジョブの投入と参照（docs/ARCHITECTURE.md §16 / §18）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 */

/** BullMQ のキュー名（docs/ARCHITECTURE.md §20）。apps 同士を import しないため定数で持つ。 */
export const RENDER_QUEUE_NAME = 'render'

/** Phase 1 で実装済みの scope。range / shot は型として受けるが、まだ出せない。 */
export const SUPPORTED_RENDER_SCOPE = 'full'

export const UNSUPPORTED_SCOPE_MESSAGE =
  'Phase 1 では scope.type=full のみ対応しています（range / shot は未対応）'

/** レンダリングジョブをキューへ投入する Port。Redis への依存を main.ts に閉じ込める。 */
export type RenderQueue = {
  /** ジョブデータは ID のみ。実データは DB から読む（ADR-0008）。 */
  enqueue(renderJobId: RenderJobId): Promise<void>
}

export type RenderRoutesDeps = TimelineRoutesDeps & {
  renderJobs: RenderJobRepository
  queue: RenderQueue
}

/** `TimelineIssue`（@ixa/timeline）の DTO。 */
export const TimelineIssueResponse = z
  .object({
    severity: z.enum(['error', 'warning']),
    code: z.string(),
    message: z.string(),
    shotId: ShotIdSchema.optional(),
  })
  .openapi('TimelineIssue')
export type TimelineIssueResponse = z.infer<typeof TimelineIssueResponse>

const toIssueResponse = (issue: TimelineIssue): TimelineIssueResponse =>
  issue.shotId === undefined
    ? { severity: issue.severity, code: issue.code, message: issue.message }
    : { severity: issue.severity, code: issue.code, message: issue.message, shotId: issue.shotId }

/**
 * API が返す RenderJob。日時は ISO8601 文字列にする。
 * `timelineSnapshot` は含めない。**1 件あたりが巨大になるため**、必要なら
 * `GET /projects/{projectId}/timeline` で現在のものを引く。
 */
export const RenderJobResponse = RenderJobSchema.omit({
  timelineSnapshot: true,
  createdAt: true,
  finishedAt: true,
})
  .extend({
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('RenderJob')
export type RenderJobResponse = z.infer<typeof RenderJobResponse>

export const toRenderJobResponse = (job: RenderJob): RenderJobResponse => ({
  id: job.id,
  projectId: job.projectId,
  scope: job.scope,
  preset: job.preset,
  status: job.status,
  progress: job.progress,
  outputAssetId: job.outputAssetId,
  error: job.error,
  createdAt: job.createdAt.toISOString(),
  finishedAt: job.finishedAt === null ? null : job.finishedAt.toISOString(),
})

const CreateRenderBody = z
  .object({
    preset: RenderPresetSchema,
    scope: RenderScopeSchema.default({ type: SUPPORTED_RENDER_SCOPE }),
  })
  .openapi('CreateRenderInput')

const CreateRenderData = z
  .object({
    renderJobId: RenderJobIdSchema,
    /** error ではない指摘。レンダリングは進むが、絵が欠ける可能性がある。 */
    warnings: z.array(TimelineIssueResponse),
  })
  .openapi('CreateRenderResult')

const RenderParams = z.object({
  id: RenderJobIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const createRenderRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/render',
  tags: ['renders'],
  summary: 'タイムラインを検証して render キューへ投入する',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: CreateRenderBody } } },
  },
  responses: {
    202: jsonContent('投入されたジョブ', successResponse(CreateRenderData)),
    ...commonErrors,
  },
})

const getRenderRoute = createRoute({
  method: 'get',
  path: '/renders/{id}',
  tags: ['renders'],
  summary: 'レンダリングジョブの状態と進捗を返す',
  request: { params: RenderParams },
  responses: {
    200: jsonContent('RenderJob', successResponse(RenderJobResponse)),
    ...commonErrors,
  },
})

const listRendersRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/renders',
  tags: ['renders'],
  summary: 'プロジェクトのレンダリングジョブ一覧（投入順）',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('RenderJob 一覧', listResponse(RenderJobResponse)),
    ...commonErrors,
  },
})

export const renderRoutes = (deps: RenderRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listRendersRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const found = await deps.renderJobs.findByProject(projectId)
      return c.json(okList(found.map(toRenderJobResponse)), 200)
    })
    .openapi(getRenderRoute, async (c) => {
      const found = await deps.renderJobs.findById(c.req.valid('param').id)
      if (found === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toRenderJobResponse(found)), 200)
    })
    .openapi(createRenderRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const { preset, scope } = c.req.valid('json')

      // 部分レンダリングは未実装。**黙って full に落とさない。**
      // 「10 秒だけのつもりが全体をレンダリングしていた」は課金と時間の事故になる。
      if (scope.type !== SUPPORTED_RENDER_SCOPE) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { scope: [UNSUPPORTED_SCOPE_MESSAGE] }), 422)
      }

      const loaded = await loadTimelineDocument(deps, projectId)
      if (loaded === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      // レンダリング前に必ず通す（@ixa/timeline）。ここで再実装しない。
      const issues = validateTimeline(loaded.source)
      const errors = issues.filter((issue) => issue.severity === 'error')
      if (errors.length > 0) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { timeline: errors.map((issue) => issue.message) }),
          422,
        )
      }

      // 何をレンダリングしたかが常に分かるよう、投入時点の TimelineDocument を保存する
      // （ARCHITECTURE.md §16）。worker はこのスナップショットだけを使う。
      const job = await deps.renderJobs.create({
        projectId,
        scope,
        preset,
        timelineSnapshot: loaded.document,
      })
      await deps.queue.enqueue(job.id)

      const warnings = issues
        .filter((issue) => issue.severity === 'warning')
        .map(toIssueResponse)

      return c.json(ok({ renderJobId: job.id, warnings }), 202)
    })
