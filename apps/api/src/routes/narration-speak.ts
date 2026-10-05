import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  NarrationLineId as NarrationLineIdSchema,
  ProjectId as ProjectIdSchema,
  VoiceJobId as VoiceJobIdSchema,
  VoiceJobKind,
  VoiceJobStatus,
  VoiceProfileId as VoiceProfileIdSchema,
  applyReadings,
  checkCostLimits,
  estimateSpeechSec,
  voiceSpecOf,
  type NarrationLine,
  type Project,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { NarrationDeps } from '../narration/deps.js'
import { planSpeak, speakContextFor, unavailableMessage, type SpeakPlan } from '../narration/speak-plan.js'
import { publishVoiceJob, startVoiceJob } from '../narration/voice-job-start.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { costLimitsFor } from './shots.js'

/**
 * 行を声にする（ADR-0038）。ジョブを作って worker の `voice` キューへ入れる（作るのは worker）。
 * 頼む前に予算を確かめる。同じ読み・声・設定の Take があれば作り直さない。
 */

const PREVIEW_TEXT_MAX = 200

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const LineParams = z.object({ id: NarrationLineIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const VoiceParams = z.object({ id: VoiceProfileIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const JobParams = z.object({ id: VoiceJobIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const BulkBody = z
  .object({
    /** 声にする行。無ければ作品の全部。 */
    lineIds: z.array(NarrationLineIdSchema).max(1000).optional(),
  })
  .openapi('SpeakNarrationLines')
const PreviewBody = z.object({ text: z.string().trim().min(1).max(PREVIEW_TEXT_MAX) }).openapi('PreviewVoice')
const CancelBody = z.object({ lineIds: z.array(NarrationLineIdSchema).max(1000).optional() }).openapi('CancelVoiceJobs')

const SpeakResult = z.object({ jobId: z.string().nullable(), reusedTakeId: z.string().nullable() }).openapi('SpeakResult')
const BulkResult = z
  .object({
    jobIds: z.array(z.string()),
    reusedTakeIds: z.array(z.string()),
    skipped: z.object({ noVoice: z.number().int(), active: z.number().int(), upToDate: z.number().int() }),
  })
  .openapi('BulkSpeakResult')
const JobResponse = z
  .object({
    id: z.string(),
    kind: VoiceJobKind,
    status: VoiceJobStatus,
    lineId: z.string().nullable(),
    resultMediaAssetId: z.string().nullable(),
    costUsd: z.number().nullable(),
    error: z.string().nullable(),
    queuedAt: z.string().datetime(),
  })
  .openapi('VoiceJob')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } })
const body = <T extends z.ZodTypeAny>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } })
const errors = {
  404: errorContent('対象が存在しない'),
  409: errorContent('作っている途中・AI の口が無い'),
  422: errorContent('声が未定・予算を超える'),
}

const speakRoute = createRoute({
  method: 'post', path: '/narration-lines/{id}/speak', tags: ['narration'],
  summary: '行を声にする（同じ指定の Take があれば作らずにそれを選ぶ）',
  request: { params: LineParams },
  responses: { 200: json('前の Take を選んだ', successResponse(SpeakResult)), 202: json('頼んだ', successResponse(SpeakResult)), ...errors },
})
const bulkRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/narration/speak', tags: ['narration'],
  summary: 'まとめて声にする（作り直しが要る行だけ。声が未定・作っている途中・今の Take が新しい行は飛ばす）',
  request: { params: ProjectParams, body: body(BulkBody) },
  responses: { 202: json('頼んだ', successResponse(BulkResult)), ...errors },
})
const previewRoute = createRoute({
  method: 'post', path: '/voices/{id}/preview', tags: ['narration'],
  summary: '声を試しに読む（Take にはしない）',
  request: { params: VoiceParams, body: body(PreviewBody) },
  responses: { 202: json('頼んだ', successResponse(z.object({ jobId: z.string() }))), ...errors },
})
const jobRoute = createRoute({
  method: 'get', path: '/voice-jobs/{id}', tags: ['narration'],
  summary: '声のジョブの状態（試しに読んだ音もここで分かる）',
  request: { params: JobParams },
  responses: { 200: json('ジョブ', successResponse(JobResponse)), ...errors },
})
const cancelRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/voice-jobs/cancel', tags: ['narration'],
  summary: '待っている・作っている声のジョブを止める（行を指定すればその行だけ）',
  request: { params: ProjectParams, body: body(CancelBody) },
  responses: { 200: json('止めたジョブ', successResponse(z.object({ cancelledJobIds: z.array(z.string()) }))), ...errors },
})

/** 予算を超えるなら理由。超えなければ null。 */
const budgetProblem = async (deps: NarrationDeps, project: Project, lineSpentUsd: number, estimateUsd: number) => {
  const decision = checkCostLimits(
    costLimitsFor(project),
    { projectSpentUsd: await deps.spentByProject(project.id), shotSpentUsd: lineSpentUsd },
    estimateUsd,
  )
  return decision.allowed ? null : decision
}

const lineSpentUsd = async (deps: NarrationDeps, line: NarrationLine): Promise<number> =>
  (await deps.takes.findByLines([line.id])).reduce((sum, take) => sum + take.costUsd, 0)

const speakInput = (line: NarrationLine, plan: Extract<SpeakPlan, { kind: 'speak' }>) => ({
  kind: 'speak' as const,
  projectId: line.projectId,
  lineId: line.id,
  voiceProfileId: plan.voice.id,
  spec: plan.spec,
  tool: plan.voice.tool,
  model: plan.voice.model,
})

export const narrationSpeakRoutes = (deps: NarrationDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(speakRoute, async (c) => {
      const { id } = c.req.valid('param')
      const line = await deps.lines.findById(id)
      const project = line === null ? null : await deps.projects.findById(line.projectId)
      if (line === null || project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const plan = await planSpeak(deps, line, await speakContextFor(deps, line.projectId))
      switch (plan.kind) {
        case 'no_voice':
          return c.json(fail('話す声を決めてください', { voiceProfileId: ['話す声を決めてください'] }), 422)
        case 'unavailable':
          return c.json(fail(unavailableMessage(plan.voice)), 409)
        case 'active':
          return c.json(fail('この行は声を作っている途中です'), 409)
        case 'up_to_date':
        case 'reuse':
          if (plan.kind === 'reuse') await deps.lines.update(line.id, { selectedTakeId: plan.takeId })
          return c.json(ok({ jobId: null, reusedTakeId: plan.takeId }), 200)
        case 'speak': {
          const problem = await budgetProblem(deps, project, await lineSpentUsd(deps, line), plan.estimateUsd)
          if (problem !== null) return c.json(fail(problem.reason, { cost: [problem.limit] }), 422)
          const job = await startVoiceJob(deps, speakInput(line, plan))
          return c.json(ok({ jobId: job.id, reusedTakeId: null }), 202)
        }
      }
    })
    .openapi(bulkRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { lineIds } = c.req.valid('json')
      const all = await deps.lines.findByProject(projectId)
      const lines = lineIds === undefined ? all : all.filter((line) => lineIds.includes(line.id))
      const context = await speakContextFor(deps, projectId)
      const plans = await Promise.all(lines.map(async (line) => ({ line, plan: await planSpeak(deps, line, context) })))
      const toSpeak = plans.flatMap(({ line, plan }) => (plan.kind === 'speak' ? [{ line, plan }] : []))
      const total = toSpeak.reduce((sum, { plan }) => sum + plan.estimateUsd, 0)
      const problem = await budgetProblem(deps, project, 0, total)
      if (problem !== null) return c.json(fail(problem.reason, { cost: [problem.limit] }), 422)
      const reused = plans.flatMap(({ line, plan }) => (plan.kind === 'reuse' ? [{ line, takeId: plan.takeId }] : []))
      for (const { line, takeId } of reused) await deps.lines.update(line.id, { selectedTakeId: takeId })
      const jobIds: string[] = []
      for (const { line, plan } of toSpeak) jobIds.push((await startVoiceJob(deps, speakInput(line, plan))).id)
      const count = (kind: SpeakPlan['kind']) => plans.filter(({ plan }) => plan.kind === kind).length
      return c.json(
        ok({
          jobIds,
          reusedTakeIds: reused.map(({ takeId }) => takeId),
          skipped: { noVoice: count('no_voice') + count('unavailable'), active: count('active'), upToDate: count('up_to_date') },
        }),
        202,
      )
    })
    .openapi(previewRoute, async (c) => {
      const { id } = c.req.valid('param')
      const voice = await deps.voices.findById(id)
      const project = voice === null ? null : await deps.projects.findById(voice.projectId)
      if (voice === null || project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      if (deps.voiceAdapter(voice.tool) === null) return c.json(fail(unavailableMessage(voice)), 409)
      const { text } = c.req.valid('json')
      const settings = await deps.audioSettings.get(voice.projectId)
      const reading = applyReadings(text, settings.readingDictionary).reading
      const estimateUsd = deps.speakCostEstimate({
        tool: voice.tool,
        model: voice.model,
        readingChars: [...reading].length,
        estimatedSec: estimateSpeechSec(reading, voice.speed),
      })
      const problem = await budgetProblem(deps, project, 0, estimateUsd)
      if (problem !== null) return c.json(fail(problem.reason, { cost: [problem.limit] }), 422)
      const job = await startVoiceJob(deps, {
        kind: 'preview',
        projectId: voice.projectId,
        voiceProfileId: voice.id,
        spec: voiceSpecOf(voice, { direction: '' }, reading),
        tool: voice.tool,
        model: voice.model,
      })
      return c.json(ok({ jobId: job.id }), 202)
    })
    .openapi(jobRoute, async (c) => {
      const job = await deps.voiceJobs.findById(c.req.valid('param').id)
      if (job === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(
        ok({
          id: job.id,
          kind: job.kind,
          status: job.status,
          lineId: job.lineId,
          resultMediaAssetId: job.resultMediaAssetId,
          costUsd: job.costUsd,
          error: job.error?.message ?? null,
          queuedAt: job.queuedAt.toISOString(),
        }),
        200,
      )
    })
    .openapi(cancelRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { lineIds } = c.req.valid('json')
      const cancelled = await deps.voiceJobs.cancelActive({ projectId, ...(lineIds === undefined ? {} : { lineIds }) })
      for (const job of cancelled) await publishVoiceJob(deps, job)
      return c.json(ok({ cancelledJobIds: cancelled.map((job) => job.id) }), 200)
    })
