import { lineagePairViolation, UPSCALE_REASON } from '@ixa/domain'
import { z } from 'zod'
import { seg } from '../api-client.js'
import { bulkResult, WireShot, WireTake } from '../wire.js'
import { defineTool, describeError, Id, jsonResult, mapLimited, round, SEED_MAX, ToolInputError } from '../tool-def.js'

/** Take（生成した動画）を作る・並べる・採用する・解像度を上げる。Take は追記のみ。 */

const WireGenerateStarted = z.object({
  jobIds: z.array(z.string()),
  resolvedModel: z.string(),
  stretchedToFit: z.boolean(),
  duplicateOfTakeId: z.string().nullable(),
})

const WireBulkGenerate = z.object({
  results: z.array(bulkResult({ jobIds: z.array(z.string()), resolvedModel: z.string() })),
  estimatedTotalUsd: z.number(),
  enqueuedCount: z.number(),
})

export const GenerateTakesInput = z.object({
  projectId: Id,
  shotIds: z.array(Id).min(1).max(200),
  model: z.string().min(1).describe('Video model id from ixa_status (e.g. "vpipe/minimax-h3-turbo") or "AUTO".'),
  count: z.number().int().min(1).max(4).default(1).describe('Takes per shot.'),
  corrections: z
    .array(z.string().min(1).max(500))
    .max(5)
    .optional()
    .describe('Fixes for this attempt, e.g. "keep the face consistent" (per-shot request).'),
  seed: z.number().int().min(0).max(SEED_MAX).optional(),
  parentTakeId: Id.optional().describe('Regenerate from this take (lineage). Only with a single shotId.'),
  regenerationReason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Why this take is remade (Japanese, shown to the user). Required with parentTakeId.'),
})

export const generateTakesTool = defineTool({
  name: 'generate_takes',
  description:
    'Generate video takes for shots (queues jobs; local models take minutes per take and run one at a time). ' +
    'Shots usually need a start frame first (draw_start_frames). Returns generation jobIds for wait ' +
    '{kind:"generation", id}. corrections/seed/parentTakeId send one request per shot.',
  input: GenerateTakesInput,
  handler: async (args, { api }) => {
    if (args.parentTakeId !== undefined && args.shotIds.length !== 1) {
      throw new ToolInputError('parentTakeId は shotIds が 1 つのときだけ使えます')
    }
    // 親を持つなら理由も要る（規則は domain の lineagePairViolation 1 か所）。
    const lineage = lineagePairViolation({
      parentTakeId: args.parentTakeId ?? null,
      regenerationReason: args.regenerationReason ?? null,
    })
    if (lineage !== null) throw new ToolInputError(`regenerationReason: ${lineage}`)
    const perShot = args.corrections !== undefined || args.seed !== undefined || args.parentTakeId !== undefined
    if (!perShot) {
      const bulk = await api.post(
        `/projects/${seg(args.projectId)}/shots/bulk/generate`,
        { shotIds: args.shotIds, model: args.model, count: args.count },
        WireBulkGenerate,
      )
      return jsonResult({
        estimatedTotalUsd: bulk.estimatedTotalUsd,
        results: bulk.results,
        jobs: bulk.results.flatMap((r) => (r.ok ? r.jobIds.map((id) => ({ kind: 'generation', id })) : [])),
      })
    }
    // 1 本の失敗で、もう積めたジョブを失わない（一括の口と同じく理由つきで返す）。
    const results = await mapLimited(args.shotIds, 4, (shotId) =>
      api
        .post(
        `/shots/${seg(shotId)}/generate`,
        {
          model: args.model,
          count: args.count,
          ...(args.corrections === undefined ? {} : { corrections: args.corrections }),
          ...(args.seed === undefined ? {} : { seed: args.seed }),
          ...(args.parentTakeId === undefined ? {} : { parentTakeId: args.parentTakeId }),
          ...(args.regenerationReason === undefined ? {} : { regenerationReason: args.regenerationReason }),
        },
        WireGenerateStarted,
      )
        .then(
          (started) => ({ shotId, ok: true as const, ...started }),
          (error: unknown) => ({ shotId, ok: false as const, reason: describeError(error) }),
        ),
    )
    return jsonResult({
      results,
      jobs: results.flatMap((r) => (r.ok ? r.jobIds.map((id) => ({ kind: 'generation', id })) : [])),
    })
  },
})

export const listTakesTool = defineTool({
  name: 'list_takes',
  description:
    'List the takes of a shot (newest last) with model, generated length, seed, cost, review state, lineage ' +
    '(upscaled takes have reason "解像度を上げる") and which one is selected. Look at them with view {shotId, takeId}.',
  input: z.object({ shotId: Id }),
  handler: async ({ shotId }, { api }) => {
    const [shot, takes] = await Promise.all([
      api.get(`/shots/${seg(shotId)}`, WireShot),
      api.get(`/shots/${seg(shotId)}/takes`, z.array(WireTake)),
    ])
    return jsonResult({
      shotId,
      shotDurationSec: round(shot.durationSec),
      selectedTakeId: shot.selectedTakeId,
      takes: [...takes]
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          id: t.id,
          index: t.index,
          model: t.modelId,
          generatedSec: round(t.spec.durationSec),
          seed: t.seedUsed,
          costUsd: t.costUsd,
          review: t.reviewStatus,
          verdict: t.humanVerdict,
          ...(t.parentTakeId === null ? {} : { parentTakeId: t.parentTakeId }),
          ...(t.regenerationReason === null ? {} : { reason: t.regenerationReason }),
          upscaled: t.regenerationReason === UPSCALE_REASON,
          selected: t.id === shot.selectedTakeId,
          createdAt: t.createdAt,
        })),
    })
  },
})

const WireBulkSelect = z.object({ results: z.array(bulkResult({ takeId: z.string(), status: z.string() })) })

export const adoptTakeTool = defineTool({
  name: 'adopt_take',
  description:
    'Select the take used in the edit. Either {shotId, takeId} for one shot, or {projectId, shotIds, rule} for many: ' +
    'rule "latest" picks the newest take of each shot (e.g. right after an upscale), "only" picks it only when the ' +
    'shot has exactly one take.',
  input: z.object({
    shotId: Id.optional(),
    takeId: Id.optional(),
    projectId: Id.optional(),
    shotIds: z.array(Id).min(1).max(200).optional(),
    rule: z.enum(['latest', 'only']).default('latest'),
  }),
  handler: async (args, { api }) => {
    if (args.shotId !== undefined && args.takeId !== undefined) {
      const shot = await api.post(`/shots/${seg(args.shotId)}/select-take`, { takeId: args.takeId }, WireShot)
      return jsonResult({ shotId: shot.id, selectedTakeId: shot.selectedTakeId, status: shot.status })
    }
    if (args.projectId !== undefined && args.shotIds !== undefined) {
      const bulk = await api.post(
        `/projects/${seg(args.projectId)}/shots/bulk/select-take`,
        { shotIds: args.shotIds, rule: args.rule },
        WireBulkSelect,
      )
      return jsonResult(bulk)
    }
    throw new ToolInputError('{shotId, takeId} か {projectId, shotIds} のどちらかを指定してください')
  },
})

const WireUpscaleJob = z.object({ id: z.string(), status: z.string() })
const WireBulkUpscale = z.object({
  results: z.array(bulkResult({ jobId: z.string().nullable() })),
  enqueuedCount: z.number(),
  dryRun: z.boolean(),
})

export const upscaleTakesTool = defineTool({
  name: 'upscale_takes',
  description:
    'Raise the resolution of takes on the local generation server (only if supported). {shotId, takeId} for one take, ' +
    'or {projectId, shotIds} for the SELECTED take of each shot (dryRun previews). The result is a new take; wait with ' +
    '{kind:"upscale", shotId, takeId: <source take>} then adopt it (adopt_take rule "latest").',
  input: z.object({
    shotId: Id.optional(),
    takeId: Id.optional(),
    projectId: Id.optional(),
    shotIds: z.array(Id).min(1).max(200).optional(),
    dryRun: z.boolean().default(false),
  }),
  handler: async (args, { api }) => {
    if (args.shotId !== undefined && args.takeId !== undefined) {
      const job = await api.post(`/shots/${seg(args.shotId)}/takes/${seg(args.takeId)}/upscale`, undefined, WireUpscaleJob)
      return jsonResult({ jobId: job.id, status: job.status, jobs: [{ kind: 'upscale', shotId: args.shotId, takeId: args.takeId }] })
    }
    if (args.projectId === undefined || args.shotIds === undefined) {
      throw new ToolInputError('{shotId, takeId} か {projectId, shotIds} のどちらかを指定してください')
    }
    const bulk = await api.post(
      `/projects/${seg(args.projectId)}/shots/bulk/upscale`,
      { shotIds: args.shotIds, dryRun: args.dryRun },
      WireBulkUpscale,
    )
    if (bulk.dryRun) return jsonResult(bulk)
    // 元にした Take（その時点で採用中のもの）を、待つための手がかりとして返す。
    const enqueued = bulk.results.flatMap((r) => (r.ok && r.jobId !== null ? [r.shotId] : []))
    const shots = await mapLimited(enqueued, 6, (id) => api.get(`/shots/${seg(id)}`, WireShot))
    return jsonResult({
      ...bulk,
      jobs: shots.flatMap((s) => (s.selectedTakeId === null ? [] : [{ kind: 'upscale', shotId: s.id, takeId: s.selectedTakeId }])),
    })
  },
})
