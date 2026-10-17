import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  AiToolId,
  ProjectId as ProjectIdSchema,
  SFX_COUNT_MAX,
  SfxCue,
  SfxJobId as SfxJobIdSchema,
  SfxJobStatus,
  sfxCueSeed,
  sfxSeedsUsedOf,
  suggestSfxCues,
  type SfxJob,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { SfxGenerationDeps, SfxSuggestionSource } from '../sfx/deps.js'
import { publishSfxJob, startSfxJob } from '../sfx/sfx-job-start.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 効果音を作る（ADR-0052）。きっかけ（時刻・長さ・説明・音量）ごとにジョブを作って worker の `sfx` キューへ入れる
 * （作るのは worker）。できた音は素材になり、1 本目が効果音の段に置かれる。範囲は domain の `SfxCue`。
 */

/** 「作った効果音」の記録に出す件数。 */
const RECENT_JOBS_LIMIT = 50
/** 1 回に頼めるきっかけの数。予告編 1 本ぶんのきっかけが収まる数。 */
export const SFX_CUES_PER_REQUEST_MAX = 30
/**
 * MOSS で 1 回に頼める本数（きっかけ × 本数）。MOSS は 1 本に数分かかり、多く頼むと後ろのジョブが
 * GPU の順番を 2 時間待ちきれずに失敗する。先に断って、Stable Audio か分けて頼むよう言う。
 */
export const MOSS_CLIPS_PER_REQUEST_MAX = 4
export const MOSS_TOO_MANY_MESSAGE =
  `MOSS SFX v2 は 1 本に数分かかるため、1 回に頼めるのは きっかけ × 本数 で ${String(MOSS_CLIPS_PER_REQUEST_MAX)} 本までです。` +
  'Stable Audio 3 で作るか、分けて頼んでください。'
/** 種の上限（サーバの契約 0〜2³¹−1）。 */
const SEED_MAX = 2 ** 31 - 1

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const JobParams = z.object({ id: SfxJobIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })

/** 選べる効果音の AI。お試しは作らないので入れない（選ぶと「使う AI」の方で断る）。 */
const SfxToolChoice = AiToolId.extract(['stable_audio_sfx', 'moss_sfx'])

const GenerateBody = z
  .object({
    cues: z.array(SfxCue).min(1).max(SFX_CUES_PER_REQUEST_MAX),
    /** 1 つのきっかけで作る本数。1 本目を置き、残りは差し替えの候補。 */
    count: z.number().int().min(1).max(SFX_COUNT_MAX).default(1),
    seed: z.number().int().min(0).max(SEED_MAX).optional(),
    /** 使う AI。省略は「使う AI」で選んでいる効果音の AI。 */
    tool: SfxToolChoice.optional(),
  })
  .openapi('GenerateSfx')

const SfxCueResponse = z.object({
  startSec: z.number(),
  durationSec: z.number(),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  volume: z.number(),
})

const SfxJobResponse = z
  .object({
    id: z.string(),
    status: SfxJobStatus,
    tool: z.string(),
    cue: SfxCueResponse,
    count: z.number().int(),
    mediaAssetIds: z.array(z.string()),
    /** できた音 1 本ずつの種（素材と同じ順。分からなければ null）。本数 1 で送ると同じ音が返る。 */
    seedsUsed: z.array(z.number().int().nullable()),
    timelineClipId: z.string().nullable(),
    error: z.string().nullable(),
    queuedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('SfxJob')

const SuggestionResponse = z
  .object({ kind: z.string(), reason: z.string(), cue: SfxCueResponse })
  .openapi('SfxCueSuggestion')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const generateRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/sfx/generate',
  tags: ['sfx'],
  summary: '効果音を作る（きっかけごとに 1 つのジョブ。1 本目を効果音の段に置く）',
  request: { params: ProjectParams, body: { required: true, content: { 'application/json': { schema: GenerateBody } } } },
  responses: {
    202: json('頼んだ', successResponse(z.object({ jobIds: z.array(z.string()) }))),
    404: errorContent('作品が無い'),
    409: errorContent('効果音の AI が選ばれていない・この環境で使えない'),
    422: errorContent('入力の誤り'),
  },
})
const jobRoute = createRoute({
  method: 'get',
  path: '/sfx-jobs/{id}',
  tags: ['sfx'],
  summary: '効果音を作るジョブの状態',
  request: { params: JobParams },
  responses: { 200: json('ジョブ', successResponse(SfxJobResponse)), 404: errorContent('ジョブが無い') },
})
const recentRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/sfx-jobs',
  tags: ['sfx'],
  summary: '作品で最近頼んだ効果音のジョブ（新しい順）',
  request: { params: ProjectParams },
  responses: { 200: json('ジョブ', successResponse(z.array(SfxJobResponse))), 404: errorContent('作品が無い') },
})
const cancelRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/sfx-jobs/cancel',
  tags: ['sfx'],
  summary: '待っている・作っている効果音のジョブを止める',
  request: { params: ProjectParams },
  responses: {
    200: json('止めたジョブ', successResponse(z.object({ cancelledJobIds: z.array(z.string()) }))),
    404: errorContent('作品が無い'),
  },
})
const suggestRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/sfx/suggestions',
  tags: ['sfx'],
  summary: 'エフェクトとトランジションから、効果音のきっかけの案を出す（作らない）',
  request: { params: ProjectParams },
  responses: { 200: json('案（時刻順）', successResponse(z.array(SuggestionResponse))), 404: errorContent('作品が無い') },
})

const toResponse = (job: SfxJob) => ({
  id: job.id,
  status: job.status,
  tool: job.tool,
  cue: { ...job.spec.cue },
  count: job.spec.count,
  mediaAssetIds: [...job.mediaAssetIds],
  seedsUsed: [...sfxSeedsUsedOf(job)],
  timelineClipId: job.timelineClipId,
  error: job.error?.message ?? null,
  queuedAt: job.queuedAt.toISOString(),
  finishedAt: job.finishedAt?.toISOString() ?? null,
})

export const sfxGenerateRoutes = (deps: SfxGenerationDeps & { readonly suggestionSource: SfxSuggestionSource }) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(generateRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      const choice = await deps.sfxModel(input.tool)
      if (choice.state === 'unavailable') return c.json(fail(choice.reason), 409)
      if (choice.tool === 'moss_sfx' && input.cues.length * input.count > MOSS_CLIPS_PER_REQUEST_MAX) {
        return c.json(fail(MOSS_TOO_MANY_MESSAGE, { cues: [MOSS_TOO_MANY_MESSAGE] }), 422)
      }
      // 1 つずつ順に入れる（1 つ入れ損ねたら、そこで止めて理由を返す。入れた分はそのまま作られる）。
      // 種はきっかけごとに変える（同じ説明・長さの 2 つのきっかけに、同じ音が鳴らないように）。
      const jobIds = await input.cues.reduce<Promise<readonly string[]>>(async (started, cue, index) => {
        const done = await started
        const job = await startSfxJob(deps, {
          projectId,
          tool: choice.tool,
          model: choice.model,
          spec: { cue, count: input.count, seed: sfxCueSeed(input.seed ?? null, index, input.count) },
        })
        return [...done, job.id]
      }, Promise.resolve([]))
      return c.json(ok({ jobIds: [...jobIds] }), 202)
    })
    .openapi(jobRoute, async (c) => {
      const job = await deps.sfxJobs.findById(c.req.valid('param').id)
      if (job === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toResponse(job)), 200)
    })
    .openapi(recentRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const jobs = await deps.sfxJobs.findRecentByProject(projectId, RECENT_JOBS_LIMIT)
      return c.json(ok(jobs.map(toResponse)), 200)
    })
    .openapi(cancelRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const cancelled = await deps.sfxJobs.cancelActive(projectId)
      for (const job of cancelled) await publishSfxJob(deps, job)
      return c.json(ok({ cancelledJobIds: cancelled.map((job) => job.id) }), 200)
    })
    .openapi(suggestRoute, async (c) => {
      const source = await deps.suggestionSource(c.req.valid('param').projectId)
      if (source === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const suggestions = suggestSfxCues(source).map((s) => ({ kind: s.kind, reason: s.reason, cue: { ...s.cue } }))
      return c.json(ok(suggestions), 200)
    })
