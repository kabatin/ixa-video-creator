import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  MUSIC_COUNT_MAX,
  MUSIC_DURATION_MAX_SEC,
  MUSIC_DURATION_MIN_SEC,
  MUSIC_LYRICS_MAX_LENGTH,
  MUSIC_PROMPT_MAX_LENGTH,
  MusicJobId as MusicJobIdSchema,
  MusicJobStatus,
  MUSIC_VOCAL_FALLBACK_TOOL,
  ProjectId as ProjectIdSchema,
  decideMusicTool,
  type MusicJob,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { MusicGenerationDeps } from '../music/deps.js'
import { publishMusicJob, startMusicJob } from '../music/music-job-start.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 曲を作る（ADR-0048）。ジョブを作って worker の `music` キューへ入れる（作るのは worker）。
 * できた曲は楽曲になり、解析に回る。範囲は ace-step-api の契約と同じ（domain の `MusicJobSpec`）。
 */

/** 「作った曲」の記録に出す件数。 */
const RECENT_JOBS_LIMIT = 20
/** 種の上限（サーバの契約 0〜2³¹−1）。 */
const SEED_MAX = 2 ** 31 - 1

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const JobParams = z.object({ id: MusicJobIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })

const GenerateBody = z
  .object({
    /** 曲調（スタイルのタグ）。 */
    prompt: z.string().trim().min(1).max(MUSIC_PROMPT_MAX_LENGTH),
    /** 歌詞。空なら歌詞なし。 */
    lyrics: z.string().max(MUSIC_LYRICS_MAX_LENGTH).default(''),
    durationSec: z.number().min(MUSIC_DURATION_MIN_SEC).max(MUSIC_DURATION_MAX_SEC).default(60),
    /** 歌なし（歌詞は使わない）。 */
    instrumental: z.boolean().default(false),
    seed: z.number().int().min(0).max(SEED_MAX).optional(),
    count: z.number().int().min(1).max(MUSIC_COUNT_MAX).default(1),
    /** 楽曲の名前。省略は曲調から付ける。 */
    title: z.string().trim().min(1).max(200).optional(),
  })
  .openapi('GenerateMusic')

const MusicJobResponse = z
  .object({
    id: z.string(),
    status: MusicJobStatus,
    prompt: z.string(),
    durationSec: z.number(),
    instrumental: z.boolean(),
    count: z.number().int(),
    title: z.string().nullable(),
    musicTrackIds: z.array(z.string()),
    error: z.string().nullable(),
    queuedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('MusicJob')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})
const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const generateRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/music/generate',
  tags: ['music'],
  summary: '曲を作る（できた曲は楽曲になり、解析に回る）',
  request: { params: ProjectParams, body: body(GenerateBody) },
  responses: {
    202: json('頼んだ', successResponse(z.object({ jobId: z.string() }))),
    404: errorContent('作品が無い'),
    409: errorContent('曲の AI が選ばれていない・この環境で使えない・その AI では作れない頼み方（歌なしだけの AI に歌詞・長すぎる。歌ありは歌える AI が使えなければ）'),
    422: errorContent('入力の誤り'),
  },
})
const jobRoute = createRoute({
  method: 'get',
  path: '/music-jobs/{id}',
  tags: ['music'],
  summary: '曲を作るジョブの状態',
  request: { params: JobParams },
  responses: { 200: json('ジョブ', successResponse(MusicJobResponse)), 404: errorContent('ジョブが無い') },
})
const recentRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/music-jobs',
  tags: ['music'],
  summary: '作品で最近頼んだ曲のジョブ（新しい順）',
  request: { params: ProjectParams },
  responses: { 200: json('ジョブ', successResponse(z.array(MusicJobResponse))), 404: errorContent('作品が無い') },
})
const cancelRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/music-jobs/cancel',
  tags: ['music'],
  summary: '待っている・作っている曲のジョブを止める',
  request: { params: ProjectParams },
  responses: {
    200: json('止めたジョブ', successResponse(z.object({ cancelledJobIds: z.array(z.string()) }))),
    404: errorContent('作品が無い'),
  },
})

const toResponse = (job: MusicJob) => ({
  id: job.id,
  status: job.status,
  prompt: job.spec.prompt,
  durationSec: job.spec.durationSec,
  instrumental: job.spec.instrumental,
  count: job.spec.count,
  title: job.spec.title,
  musicTrackIds: [...job.musicTrackIds],
  error: job.error?.message ?? null,
  queuedAt: job.queuedAt.toISOString(),
  finishedAt: job.finishedAt?.toISOString() ?? null,
})

export const musicGenerateRoutes = (deps: MusicGenerationDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(generateRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      const choice = await deps.musicModel()
      if (choice.state === 'unavailable') return c.json(fail(choice.reason), 409)
      // 歌なしだけの AI（既定の Stable Audio）に歌ありが来たら、歌える AI が使えればそちらで作る（制作者 2026-10-19）。
      // 使えない・ほかの理由で作れない頼み方（歌詞だけ・190 秒超）は、黙って捨てずに断る。
      const fallback = await deps.musicModel(MUSIC_VOCAL_FALLBACK_TOOL)
      const decision = decideMusicTool(
        choice.tool,
        input,
        (tool) => tool === MUSIC_VOCAL_FALLBACK_TOOL && fallback.state === 'ready',
      )
      if (decision.state === 'rejected') return c.json(fail(decision.reason), 409)
      const chosen = decision.rerouted && fallback.state === 'ready' ? fallback : choice
      const job = await startMusicJob(deps, {
        projectId,
        tool: chosen.tool,
        model: chosen.model,
        spec: {
          prompt: input.prompt,
          lyrics: input.lyrics,
          durationSec: input.durationSec,
          instrumental: input.instrumental,
          seed: input.seed ?? null,
          count: input.count,
          title: input.title ?? null,
        },
      })
      return c.json(ok({ jobId: job.id }), 202)
    })
    .openapi(jobRoute, async (c) => {
      const job = await deps.musicJobs.findById(c.req.valid('param').id)
      if (job === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toResponse(job)), 200)
    })
    .openapi(recentRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const jobs = await deps.musicJobs.findRecentByProject(projectId, RECENT_JOBS_LIMIT)
      return c.json(ok(jobs.map(toResponse)), 200)
    })
    .openapi(cancelRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const cancelled = await deps.musicJobs.cancelActive(projectId)
      for (const job of cancelled) await publishMusicJob(deps, job)
      return c.json(ok({ cancelledJobIds: cancelled.map((job) => job.id) }), 200)
    })
