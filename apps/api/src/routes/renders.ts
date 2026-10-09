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
import {
  overlapsRange,
  renderContentKey,
  sliceTimelineDocument,
  timelineRangeProblem,
  validateTimeline,
  type TimelineIssue,
  type TimelineRange,
} from '@ixa/timeline'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { loadTimelineDocument, type TimelineRoutesDeps } from './timeline.js'

/**
 * レンダリングジョブの投入と参照（docs/ARCHITECTURE.md §16 / §18）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 */

/** BullMQ のキュー名（docs/ARCHITECTURE.md §20）。apps 同士を import しないため定数で持つ。 */
export const RENDER_QUEUE_NAME = 'render'

/** 既定の scope。range（一部だけ）も出せる。shot は型として受けるが出さない（range で足りる）。 */
export const SUPPORTED_RENDER_SCOPE = 'full'

export const UNSUPPORTED_SCOPE_MESSAGE =
  'Shot 単位の書き出しは scope.type=range（区間）で指定してください'

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
  normalizeLoudness: job.normalizeLoudness,
  loudnessLufs: job.loudnessLufs,
  createdAt: job.createdAt.toISOString(),
  finishedAt: job.finishedAt === null ? null : job.finishedAt.toISOString(),
})

const CreateRenderBody = z
  .object({
    preset: RenderPresetSchema,
    scope: RenderScopeSchema.default({ type: SUPPORTED_RENDER_SCOPE }),
    /** 音量を YouTube・SNS の基準（-14 LUFS）に揃えるか（ADR-0039）。既定は揃える。 */
    normalizeLoudness: z.boolean().default(true),
    /**
     * 前回うまくいった書き出しと中身が同じでも書き出す。**既定は false**——同じなら始める前に 409 で知らせる
     * （制作者 2026-10-09「時間かけて書き出ししてから保存で失敗すると時間の無駄」）。
     * アプリを更新して描き方が変わったときなど、人が「もう一度」を選んだときだけ true。
     */
    force: z.boolean().default(false),
  })
  .openapi('CreateRenderInput')

const CreateRenderData = z
  .object({
    renderJobId: RenderJobIdSchema,
    /** error ではない指摘。レンダリングは進むが、絵が欠ける可能性がある。 */
    warnings: z.array(TimelineIssueResponse),
  })
  .openapi('CreateRenderResult')

/** 409 の本文。**前回の書き出し**を指す（画面がそれを示して、もう一度書き出すかを聞く）。 */
const DuplicateRenderBody = z
  .object({
    success: z.literal(false),
    error: z.string(),
    duplicateOf: z.object({
      renderJobId: RenderJobIdSchema,
      finishedAt: z.string().datetime().nullable(),
    }),
  })
  .openapi('DuplicateRender')

export const DUPLICATE_RENDER_MESSAGE = '前回の書き出しと中身が同じです'

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

/**
 * 前回うまくいった書き出しのうち、**同じ中身になるもの**（新しい順に最初の 1 つ）。
 * 比べるのは書き出しの設定（プリセット・範囲・音量）と文書。文書は署名だけが違うものを同じとみなす。
 */
const findSameRender = async (
  renderJobs: Pick<RenderJobRepository, 'findByProject'>,
  wanted: {
    readonly projectId: RenderJob['projectId']
    readonly preset: RenderJob['preset']
    readonly scope: RenderJob['scope']
    readonly normalizeLoudness: boolean
    readonly timelineSnapshot: RenderJob['timelineSnapshot']
  },
): Promise<RenderJob | null> => {
  const wantedKey = renderContentKey({
    preset: wanted.preset,
    scope: wanted.scope,
    normalizeLoudness: wanted.normalizeLoudness,
    timeline: wanted.timelineSnapshot,
  })
  const jobs = await renderJobs.findByProject(wanted.projectId)
  return (
    [...jobs]
      .filter((job) => job.status === 'succeeded' && job.outputAssetId !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .find(
        (job) =>
          renderContentKey({
            preset: job.preset,
            scope: job.scope,
            normalizeLoudness: job.normalizeLoudness,
            timeline: job.timelineSnapshot,
          }) === wantedKey,
      ) ?? null
  )
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
    409: jsonContent('前回うまくいった書き出しと中身が同じ（force で書き出せる）', DuplicateRenderBody),
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
      const { preset, scope, normalizeLoudness, force } = c.req.valid('json')

      // Shot 単位は range で指定する。**黙って full に落とさない。**
      // 「10 秒だけのつもりが全体をレンダリングしていた」は課金と時間の事故になる。
      if (scope.type === 'shot') {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { scope: [UNSUPPORTED_SCOPE_MESSAGE] }), 422)
      }

      const loaded = await loadTimelineDocument(deps, projectId)
      if (loaded === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      // 一部だけを書き出す（制作者 2026-10-02「選択した Shot だけを動画として出力」）。区間の規則は @ixa/timeline の 1 か所。
      const range: TimelineRange | null =
        scope.type === 'range' ? { startSec: scope.start, endSec: scope.end } : null
      const rangeProblem = range === null ? null : timelineRangeProblem(loaded.document.durationSec, range)
      if (rangeProblem !== null) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { scope: [rangeProblem] }), 422)
      }

      // レンダリング前に必ず通す（@ixa/timeline）。ここで再実装しない。
      // 一部だけなら、区間の外の Shot の指摘では止めない（Shot に紐づかない指摘は止める）。
      const inRange =
        range === null
          ? null
          : new Set(loaded.source.shots.filter((shot) => overlapsRange(shot, range)).map((shot) => shot.id))
      const issues = validateTimeline(loaded.source).filter(
        (issue) => inRange === null || issue.shotId === undefined || inRange.has(issue.shotId),
      )
      const errors = issues.filter((issue) => issue.severity === 'error')
      if (errors.length > 0) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { timeline: errors.map((issue) => issue.message) }),
          422,
        )
      }

      // 何をレンダリングしたかが常に分かるよう、投入時点の TimelineDocument を保存する
      // （ARCHITECTURE.md §16）。worker はこのスナップショットだけを使う。一部だけなら切った後のもの。
      const timelineSnapshot = range === null ? loaded.document : sliceTimelineDocument(loaded.document, range)

      // **始める前に知らせる。** 同じ中身を書き出し直すと、時間をかけたうえ同じものができるだけ。
      if (!force) {
        const previous = await findSameRender(deps.renderJobs, {
          projectId,
          preset,
          scope,
          normalizeLoudness,
          timelineSnapshot,
        })
        if (previous !== null) {
          return c.json(
            {
              success: false as const,
              error: DUPLICATE_RENDER_MESSAGE,
              duplicateOf: { renderJobId: previous.id, finishedAt: previous.finishedAt?.toISOString() ?? null },
            },
            409,
          )
        }
      }

      const job = await deps.renderJobs.create({
        projectId,
        scope,
        preset,
        normalizeLoudness,
        timelineSnapshot,
      })
      await deps.queue.enqueue(job.id)

      const warnings = issues
        .filter((issue) => issue.severity === 'warning')
        .map(toIssueResponse)

      return c.json(ok({ renderJobId: job.id, warnings }), 202)
    })
