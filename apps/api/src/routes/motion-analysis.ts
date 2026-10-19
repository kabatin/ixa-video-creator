import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { ShotId as ShotIdSchema, TakeId as TakeIdSchema, type MotionAnalysis } from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { MotionAnalysisDeps } from '../motion/deps.js'
import { shotMotionView, takeMotionStatus, type TakeMotionStatus } from '../motion/shot-motion.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * Take の動きの分析（ADR-0054）。API は worker の `motion` キューへ積み、結果を読むだけ（測るのは worker）。
 * Take の口は Take の秒、Shot の口は採用中の Take の結果をタイムラインの秒に直して返す。
 */

export const NO_SELECTED_TAKE_MESSAGE = 'この Shot には採用中の Take がありません。Take を作って選んでから分析してください。'

const TakeParams = z.object({ id: TakeIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const ShotParams = z.object({ id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })

const MotionStateSchema = z.enum(['none', 'queued', 'running', 'succeeded', 'failed'])

const EventSchema = z.object({
  kind: z.enum(['moment', 'sustained', 'pass_by', 'ambient']),
  label: z.string(),
  sfxPrompt: z.string(),
  confidence: z.number(),
})
const OnsetSchema = z.object({ atSec: z.number(), strength: z.number() })

const TakeMotionResponse = z
  .object({
    takeId: z.string(),
    state: MotionStateSchema,
    failureMessage: z.string().nullable(),
    analysis: z
      .object({
        analyzerVersion: z.string(),
        visionUsed: z.boolean(),
        costUsd: z.number(),
        energyHopSec: z.number(),
        energy: z.array(z.number()),
        onsets: z.array(OnsetSchema),
        events: z.array(EventSchema.extend({ takeStartSec: z.number(), takeDurationSec: z.number() })),
        analyzedAt: z.string().datetime(),
      })
      .nullable(),
  })
  .openapi('TakeMotionAnalysis')

const ShotMotionResponse = z
  .object({
    shotId: z.string(),
    takeId: z.string().nullable(),
    state: MotionStateSchema,
    failureMessage: z.string().nullable(),
    /** AI（Claude）がコマを見たか。false は動きの山だけの案。分析が無ければ null。 */
    visionUsed: z.boolean().nullable(),
    analyzedAt: z.string().datetime().nullable(),
    energy: z.object({ startSec: z.number(), hopSec: z.number(), values: z.array(z.number()) }).nullable(),
    onsets: z.array(OnsetSchema),
    events: z.array(EventSchema.extend({ startSec: z.number(), durationSec: z.number() })),
    suggestions: z.array(
      z.object({
        kind: z.string(),
        reason: z.string(),
        cue: z.object({
          startSec: z.number(),
          durationSec: z.number(),
          prompt: z.string(),
          volume: z.number(),
          /** 音の一番大きいところを時刻に合わせる印（瞬間・通り過ぎ）。そのまま効果音の頼みに渡す。 */
          align: z.object({ to: z.literal('peak'), notBeforeSec: z.number() }).optional(),
        }),
      }),
    ),
  })
  .openapi('ShotMotionAnalysis')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})
const Queued = successResponse(z.object({ state: MotionStateSchema }))

const analyzeTakeRoute = createRoute({
  method: 'post',
  path: '/takes/{id}/motion-analysis',
  tags: ['motion'],
  summary: 'Take の動きを分析する（積むだけ。分析済みなら worker は何もしない）',
  request: { params: TakeParams },
  responses: { 202: json('積んだ', Queued), 404: errorContent('Take が無い') },
})
const takeRoute = createRoute({
  method: 'get',
  path: '/takes/{id}/motion-analysis',
  tags: ['motion'],
  summary: 'Take の動きの分析（Take の秒）',
  request: { params: TakeParams },
  responses: { 200: json('分析', successResponse(TakeMotionResponse)), 404: errorContent('Take が無い') },
})
const analyzeShotRoute = createRoute({
  method: 'post',
  path: '/shots/{id}/motion-analysis',
  tags: ['motion'],
  summary: 'Shot の採用中の Take の動きを分析する（積むだけ）',
  request: { params: ShotParams },
  responses: {
    202: json('積んだ', Queued),
    404: errorContent('Shot が無い'),
    409: errorContent('採用中の Take が無い'),
  },
})
const shotRoute = createRoute({
  method: 'get',
  path: '/shots/{id}/motion-analysis',
  tags: ['motion'],
  summary: 'Shot の採用中の Take の動きの分析（タイムラインの秒）と、効果音のきっかけの案',
  request: { params: ShotParams },
  responses: { 200: json('分析', successResponse(ShotMotionResponse)), 404: errorContent('Shot が無い') },
})

const analysisBody = (analysis: MotionAnalysis) => ({
  analyzerVersion: analysis.analyzerVersion,
  visionUsed: analysis.visionUsed,
  costUsd: analysis.costUsd,
  energyHopSec: analysis.energyHopSec,
  energy: [...analysis.energy],
  onsets: analysis.onsets.map((onset) => ({ ...onset })),
  events: analysis.events.map((event) => ({ ...event })),
  analyzedAt: analysis.createdAt.toISOString(),
})

const takeBody = (takeId: string, status: TakeMotionStatus) => ({
  takeId,
  state: status.state,
  failureMessage: status.failureMessage,
  analysis: status.analysis === null ? null : analysisBody(status.analysis),
})

/** 積む。待っている・動いている間は積み増さず、その状態を返す。 */
const enqueue = async (deps: MotionAnalysisDeps, takeId: Parameters<MotionAnalysisDeps['queue']['enqueue']>[0]) => {
  const current = await deps.queue.stateOf(takeId)
  if (current !== null) return current
  await deps.queue.enqueue(takeId)
  return 'queued' as const
}

export const motionAnalysisRoutes = (deps: MotionAnalysisDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(analyzeTakeRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.takes.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok({ state: await enqueue(deps, id) }), 202)
    })
    .openapi(takeRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.takes.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(takeBody(id, await takeMotionStatus(deps, id))), 200)
    })
    .openapi(analyzeShotRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      if (shot.selectedTakeId === null) return c.json(fail(NO_SELECTED_TAKE_MESSAGE), 409)
      return c.json(ok({ state: await enqueue(deps, shot.selectedTakeId) }), 202)
    })
    .openapi(shotRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const view = await shotMotionView(deps, shot)
      return c.json(
        ok({
          shotId: shot.id,
          takeId: view.takeId,
          state: view.state,
          failureMessage: view.failureMessage,
          visionUsed: view.analysis?.visionUsed ?? null,
          analyzedAt: view.analysis?.createdAt.toISOString() ?? null,
          energy: view.energy === null ? null : { ...view.energy, values: [...view.energy.values] },
          onsets: view.onsets.map((onset) => ({ ...onset })),
          events: view.events.map((event) => ({ ...event })),
          suggestions: view.suggestions.map((s) => ({ kind: s.kind, reason: s.reason, cue: { ...s.cue } })),
        }),
        200,
      )
    })
