import { lineagePairViolation, UPSCALE_REASON } from '@ixa/domain'
import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import { assertShotsInProject, assertTakesOfShot } from '../lib/project-scope.js'
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
  autoRetake: z
    .boolean()
    .default(false)
    .describe(
      'Review each take automatically when it is ready, and if the review fails regenerate with the review fixes, up to the ' +
        'project limit (regenerated takes keep doing so). Default false: no automatic review; check takes yourself with ' +
        'review_take, and a failed take is only marked "retake recommended". Use true for unattended overnight runs; it costs time and tokens.',
    ),
})

export const generateTakesTool = defineTool({
  name: 'generate_takes',
  risk: 'costly',
  description:
    'Generate video takes for shots (queues jobs; local models take minutes per take and run one at a time). ' +
    'Shots usually need a start frame first (draw_start_frames). Returns generation jobIds for wait ' +
    '{kind:"generation", id}. corrections/seed/parentTakeId/autoRetake send one request per shot. ' +
    'By default takes are not reviewed or regenerated automatically (use review_take); set autoRetake for unattended runs.',
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
    // 積む前に、Shot も親 Take もこの作品のものか確かめる（lib/project-scope.ts）。
    await assertShotsInProject(api, args.projectId, args.shotIds)
    const [onlyShot] = args.shotIds
    if (args.parentTakeId !== undefined && onlyShot !== undefined) {
      await assertTakesOfShot(api, args.projectId, onlyShot, [args.parentTakeId])
    }
    const perShot =
      args.corrections !== undefined || args.seed !== undefined || args.parentTakeId !== undefined || args.autoRetake
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
          ...(args.autoRetake ? { autoRetake: true } : {}),
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

/** Take の動画の最後のコマ（media の処理が切り出す）。まだ切り出していなければ null。 */
const WireTakeMedia = z.object({ lastFrameAssetId: z.string().nullable().default(null) })

export const lastFrameOf = async (api: ApiClient, mediaAssetId: string): Promise<string | null> =>
  (await api.get(`/media/${seg(mediaAssetId)}`, WireTakeMedia)).lastFrameAssetId

export const listTakesTool = defineTool({
  name: 'list_takes',
  risk: 'read',
  description:
    'List the takes of a shot (newest last) with model, generated length, seed, cost, review state, lineage ' +
    '(upscaled takes have reason "解像度を上げる") and which one is selected. includeLastFrame adds lastFrameAssetId ' +
    '(the final frame; pass it to set_start_frame {mediaAssetId} to continue the next shot). View with view {shotId, takeId}.',
  input: z.object({
    projectId: Id,
    shotId: Id,
    includeLastFrame: z.boolean().default(false).describe('Also look up each take\'s final frame (one request per take).'),
  }),
  handler: async ({ projectId, shotId, includeLastFrame }, { api }) => {
    await assertShotsInProject(api, projectId, [shotId])
    const [shot, takes] = await Promise.all([
      api.get(`/shots/${seg(shotId)}`, WireShot),
      api.get(`/shots/${seg(shotId)}/takes`, z.array(WireTake)),
    ])
    const sorted = [...takes].sort((a, b) => a.index - b.index)
    // 最後のコマは Take ごとに 1 回引くので、頼まれたときだけ（一括の口は API に無い）。
    const lastFrames = includeLastFrame ? await mapLimited(sorted, 4, (t) => lastFrameOf(api, t.mediaAssetId)) : null
    return jsonResult({
      shotId,
      shotDurationSec: round(shot.durationSec),
      // 速さと使い始め（ADR-0050）。Take がこの尺 × 速さより短ければ、再生は足りる速さまで落ちる。
      speed: shot.speed ?? 1,
      sourceInSec: round(shot.sourceInSec ?? 0),
      selectedTakeId: shot.selectedTakeId,
      takes: sorted.map((t, i) => ({
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
          ...(lastFrames === null ? {} : { lastFrameAssetId: lastFrames[i] ?? null }),
          createdAt: t.createdAt,
        })),
    })
  },
})

const WireBulkSelect = z.object({ results: z.array(bulkResult({ takeId: z.string(), status: z.string() })) })
const WireBulkUnselect = z.object({ results: z.array(bulkResult({ status: z.string() })) })

export const adoptTakeTool = defineTool({
  name: 'adopt_take',
  risk: 'write',
  description:
    'Select the take used in the edit. Either {shotId, takeId} for one shot, or {shotIds, rule} for many: ' +
    'rule "latest" picks the newest take of each shot (e.g. right after an upscale), "only" picks it only when the ' +
    'shot has exactly one take. unselect: true removes the selection instead ({shotId} or {shotIds}; takes are kept).',
  input: z.object({
    projectId: Id,
    shotId: Id.optional(),
    takeId: Id.optional(),
    shotIds: z.array(Id).min(1).max(200).optional(),
    rule: z.enum(['latest', 'only']).default('latest'),
    unselect: z.boolean().default(false),
  }),
  handler: async (args, { api }) => {
    if (args.unselect && args.takeId !== undefined) throw new ToolInputError('unselect のときは takeId を付けないでください')
    // 採用を変える前に、Shot（と Take）がこの作品のものか確かめる。
    if (args.shotId !== undefined && args.takeId !== undefined) {
      await assertTakesOfShot(api, args.projectId, args.shotId, [args.takeId])
    } else {
      const shotIds = args.shotId === undefined ? (args.shotIds ?? []) : [args.shotId]
      if (shotIds.length > 0) await assertShotsInProject(api, args.projectId, shotIds)
    }
    if (args.unselect) {
      if (args.shotId !== undefined) {
        const shot = await api.request('DELETE', `/shots/${seg(args.shotId)}/selected-take`, WireShot)
        return jsonResult({ shotId: shot.id, selectedTakeId: shot.selectedTakeId, status: shot.status })
      }
      if (args.shotIds !== undefined) {
        const bulk = await api.post(
          `/projects/${seg(args.projectId)}/shots/bulk/unselect-take`,
          { shotIds: args.shotIds },
          WireBulkUnselect,
        )
        return jsonResult(bulk)
      }
      throw new ToolInputError('{shotId} か {shotIds} のどちらかを指定してください')
    }
    if (args.shotId !== undefined && args.takeId !== undefined) {
      const shot = await api.post(`/shots/${seg(args.shotId)}/select-take`, { takeId: args.takeId }, WireShot)
      return jsonResult({ shotId: shot.id, selectedTakeId: shot.selectedTakeId, status: shot.status })
    }
    if (args.shotIds !== undefined) {
      const bulk = await api.post(
        `/projects/${seg(args.projectId)}/shots/bulk/select-take`,
        { shotIds: args.shotIds, rule: args.rule },
        WireBulkSelect,
      )
      return jsonResult(bulk)
    }
    throw new ToolInputError('{shotId, takeId} か {shotIds} のどちらかを指定してください')
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
  risk: 'costly',
  description:
    'Raise the resolution of takes on the local generation server (only if supported). {shotId, takeId} for one take, ' +
    'or {shotIds} for the SELECTED take of each shot (dryRun previews). The result is a new take; wait with ' +
    '{kind:"upscale", shotId, takeId: <source take>} then adopt it (adopt_take rule "latest").',
  input: z.object({
    projectId: Id,
    shotId: Id.optional(),
    takeId: Id.optional(),
    shotIds: z.array(Id).min(1).max(200).optional(),
    dryRun: z.boolean().default(false),
  }),
  handler: async (args, { api }) => {
    if (args.shotId !== undefined && args.takeId !== undefined) {
      await assertTakesOfShot(api, args.projectId, args.shotId, [args.takeId])
      const job = await api.post(`/shots/${seg(args.shotId)}/takes/${seg(args.takeId)}/upscale`, undefined, WireUpscaleJob)
      return jsonResult({ jobId: job.id, status: job.status, jobs: [{ kind: 'upscale', shotId: args.shotId, takeId: args.takeId }] })
    }
    if (args.shotIds === undefined) throw new ToolInputError('{shotId, takeId} か {shotIds} のどちらかを指定してください')
    await assertShotsInProject(api, args.projectId, args.shotIds)
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

const WireHidden = z.object({ shot: WireShot })

export const hideTakesTool = defineTool({
  name: 'hide_takes',
  risk: 'destructive',
  description:
    'Hide unwanted takes of a shot from lists and comparisons (the file, cost and history are kept). ' +
    'The selected take cannot be hidden: adopt_take {unselect} or adopt another first.',
  input: z.object({ projectId: Id, shotId: Id, takeIds: z.array(Id).min(1).max(50) }),
  handler: async ({ projectId, shotId, takeIds }, { api }) => {
    // 別の作品の Take が 1 本でも混じれば、1 本も隠さない。
    await assertTakesOfShot(api, projectId, shotId, takeIds)
    // 1 本の失敗（採用中など）で残りを止めない。理由つきで返す。
    const results = await mapLimited(takeIds, 4, (takeId) =>
      api.request('DELETE', `/takes/${seg(takeId)}`, WireHidden).then(
        (hidden) => ({ takeId, ok: true as const, shotStatus: hidden.shot.status }),
        (error: unknown) => ({ takeId, ok: false as const, reason: describeError(error) }),
      ),
    )
    return jsonResult({ hidden: results.filter((r) => r.ok).length, results })
  },
})
