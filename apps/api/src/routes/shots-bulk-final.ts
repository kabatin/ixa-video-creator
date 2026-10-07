import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  ModelId as ModelIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  GenerationJobId as GenerationJobIdSchema,
  REMAKE_FINAL_REASON,
  checkCostLimits,
  finalTierModelOf,
  quantizeDuration,
  type GenerationJob,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import { buildGeneration, type CompiledGeneration } from '@ixa/generation'
import { estimateCostUsd, estimateLatencySec, type VideoModelDescriptor } from '@ixa/provider-core'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { MAX_BULK_SHOT_IDS } from './shots-bulk.js'
import { budgetRejection, enqueuePlanned, resolveShot } from './shots-bulk-plan.js'
import {
  costLimitsFor,
  generationFailureFields,
  generationPorts,
  type ShotRoutesDeps,
} from './shots.js'

/**
 * 採用した試作を、まとめて**本番の画質で作り直す**（ADR-0042 段 4 / 資料 3.4「夜間の一括生成」）。
 *
 * 1 本ずつ Take のメニューから押す形はあったが、夜のうちに何本も積む導線が無かった。
 * **仕様は変えない。** 同じ Shot・同じシード・同じ親で、段（`qualityTier`）だけ `final` にする。
 *
 * 判断は 1 件ずつの経路と共有する。
 * - 本番のモデル選び → domain の `finalTierModelOf`（**モデル ID を書き写さない**）
 * - 費用の上限と投入 → `shots-bulk-plan.ts`（一括生成とまったく同じ関数）
 *
 * **飛ばした Shot は理由つきで返す**（L-015）。件数だけに畳むと、何が積まれていないか分からない。
 */

export const NO_SELECTED_TAKE_REASON = '採用している Take がありません'
export const NO_FINAL_TIER_REASON = '採用中の Take の AI に、本番の段がありません'
export const ALREADY_FINAL_REASON = '採用中の Take が、すでに本番で作られています'
export const ALREADY_RUNNING_REASON = '同じものを作っている最中です'
export const ALREADY_REMADE_REASON = '同じ仕様の Take が、すでにあります'
/** 採用 Take が消えている（論理削除）。行は残るので「無い」とは別の理由にする。 */
export const MISSING_TAKE_REASON = '採用している Take が見つかりません'

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const RemakeFinalBody = z
  .object({
    shotIds: z.array(ShotIdSchema).min(1).max(MAX_BULK_SHOT_IDS),
    /**
     * **押す前の下見。** 同じ段取りを投入の手前で止める。
     * 画面はこれで「何本・どれくらい掛かる・何が飛ぶ」を出してから押させる。
     */
    dryRun: z.boolean().default(false),
  })
  .openapi('BulkRemakeFinalInput')

const RemakeFinalData = z
  .object({
    results: z.array(
      z.discriminatedUnion('ok', [
        z.object({
          shotId: ShotIdSchema,
          ok: z.literal(true),
          /** 下見のときは空。投入したときだけ入る。 */
          jobIds: z.array(GenerationJobIdSchema),
          resolvedModel: ModelIdSchema,
          /** この 1 本に掛かる時間の目安（秒）。尺に比例する（`estimateLatencySec`）。 */
          estimatedLatencySec: z.number().nonnegative(),
        }),
        z.object({ shotId: ShotIdSchema, ok: z.literal(false), reason: z.string() }),
      ]),
    ),
    /** 積む（積んだ）本数。 */
    enqueuedCount: z.number().int().nonnegative(),
    /** 見積の合計（USD）。手元の GPU で作るモデルは 0。 */
    estimatedTotalUsd: z.number().nonnegative(),
    /**
     * 全部できるまでの目安（秒）。**順番に 1 本ずつ作る前提で足し合わせる。**
     * 同時に走る本数は worker の設定で変わるので、ここでは掛け算で減らさない（短く見せない）。
     */
    estimatedTotalLatencySec: z.number().nonnegative(),
    /** 下見なら true（1 件も投入していない）。 */
    dryRun: z.boolean(),
  })
  .openapi('BulkRemakeFinalResult')

const remakeFinalRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/shots/bulk/remake-final',
  tags: ['shots'],
  summary: '選んだ Shot の採用 Take を、まとめて本番の画質で作り直す',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: RemakeFinalBody } } },
  },
  responses: {
    200: {
      description: '下見（1 件も投入していない）',
      content: { 'application/json': { schema: successResponse(RemakeFinalData) } },
    },
    202: {
      description: '1 件ずつの結果',
      content: { 'application/json': { schema: successResponse(RemakeFinalData) } },
    },
    404: errorContent('Project が存在しない'),
    422: errorContent('合計が予算を超えた（1 件も投入していない）'),
  },
})

/** 作る尺（worker と同じ決め方）。その尺で作れないならモデルの一律の目安に戻す。 */
const outputSecOf = (shot: Shot, model: VideoModelDescriptor): number | null => {
  try {
    return quantizeDuration(shot.durationSec, model.capabilities.durations)
  } catch {
    return null
  }
}

const isActive = (job: GenerationJob): boolean => job.status === 'queued' || job.status === 'running'

/** 見積りまで済ませた 1 件。 */
type Planned = {
  readonly shot: Shot
  readonly take: Take
  readonly compiled: CompiledGeneration<VideoModelDescriptor>
  readonly estimatedUsd: number
  readonly estimatedLatencySec: number
}

type PlanEntry =
  | { readonly shotId: Shot['id']; readonly planned: Planned }
  | { readonly shotId: Shot['id']; readonly reason: string }

export type ShotBulkFinalDeps = ShotRoutesDeps

/**
 * 1 件ぶんの段取り。**投入はしない。**
 *
 * 断る理由はここで出し切る。投入してから worker が断ると、人は待ってから失敗を知る。
 */
const planOne = async (
  deps: ShotBulkFinalDeps,
  project: Project,
  shot: Shot,
): Promise<{ readonly planned: Planned } | { readonly reason: string }> => {
  if (shot.selectedTakeId === null) return { reason: NO_SELECTED_TAKE_REASON }
  // 見えなくした Take も親にできる（作り直しの元が消されていても記録としては正しい）。
  const take = await deps.takes.findById(shot.selectedTakeId, { includeHidden: true })
  if (take === null) return { reason: MISSING_TAKE_REASON }

  /**
   * 本番の段は**宣言から引く**（`finalTierModelOf`）。登録されているモデル全部から探す。
   * 「使う AI」の絞り込みは掛けない。明示したモデルは 1 件ずつの経路でもそのまま引ける。
   */
  const final = finalTierModelOf(deps.registry.allModels(), take.modelId)
  if (final === null) return { reason: NO_FINAL_TIER_REASON }
  if (final.id === take.modelId) return { reason: ALREADY_FINAL_REASON }

  let compiled: CompiledGeneration<VideoModelDescriptor>
  try {
    compiled = await buildGeneration(await generationPorts(deps), shot, project, final.id, {
      // **同じシードで作り直す。** 省略は「Provider に任せる」で、0 は正当なシード。
      ...(take.seedUsed === null ? {} : { seed: take.seedUsed }),
    })
  } catch (error) {
    // 知らない失敗は握り潰さない。1 件の不調で全体を 500 にするのが正しい。
    const fields = generationFailureFields(error)
    if (fields === null) throw error
    return { reason: Object.values(fields).flat().join(' / ') }
  }

  /**
   * **二度押しで二重に積まない。** 夜に積む操作なので、同じ選択で 2 回押されうる。
   * 既にある Take も、作っている最中のジョブも、同じ仕様（`specHash`）なら断る。
   */
  const [takes, jobs] = await Promise.all([
    deps.takes.findByShot(shot.id, { includeHidden: true }),
    deps.generationJobs.findByShot(shot.id),
  ])
  if (jobs.some((job) => isActive(job) && job.specHash === compiled.specHash)) {
    return { reason: ALREADY_RUNNING_REASON }
  }
  if (takes.some((existing) => existing.specHash === compiled.specHash)) {
    return { reason: ALREADY_REMADE_REASON }
  }

  const estimatedUsd = estimateCostUsd(compiled.spec, compiled.model)
  const limits = costLimitsFor(project)
  const [projectSpentUsd, shotSpentUsd] = await Promise.all([
    deps.takes.sumCostByProject(project.id),
    deps.takes.sumCostByShot(shot.id),
  ])
  const decision = checkCostLimits(limits, { projectSpentUsd, shotSpentUsd }, estimatedUsd)
  if (!decision.allowed) return { reason: decision.reason }

  return {
    planned: {
      shot,
      take,
      compiled,
      estimatedUsd,
      estimatedLatencySec: estimateLatencySec(
        compiled.model.economics,
        outputSecOf(shot, compiled.model),
      ),
    },
  }
}

export const shotBulkFinalRoutes = (deps: ShotBulkFinalDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(remakeFinalRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    const project = await deps.projects.findById(projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const { shotIds, dryRun } = c.req.valid('json')

    /** まず全件を段取りする。**ここでは 1 件も投入しない。** */
    const plan: PlanEntry[] = []
    for (const shotId of shotIds) {
      const resolved = await resolveShot(deps, projectId, shotId)
      if (!('shot' in resolved)) {
        plan.push({ shotId, reason: resolved.reason })
        continue
      }
      const one = await planOne(deps, project, resolved.shot)
      plan.push('planned' in one ? { shotId, planned: one.planned } : { shotId, reason: one.reason })
    }

    const planned = plan.flatMap((entry) => ('planned' in entry ? [entry.planned] : []))
    const estimatedTotalUsd = planned.reduce((total, p) => total + p.estimatedUsd, 0)
    const estimatedTotalLatencySec = planned.reduce((total, p) => total + p.estimatedLatencySec, 0)

    // **予算は合計で見る。** 超えたら 1 件も投入しない（一括生成と同じ判定）。
    const rejection = budgetRejection(
      costLimitsFor(project),
      await deps.takes.sumCostByProject(project.id),
      estimatedTotalUsd,
      planned.length,
    )
    if (rejection !== null) return c.json(fail(rejection.reason, rejection.fields), 422)

    const jobIdsByShot = dryRun
      ? new Map<Shot['id'], never[]>()
      : await enqueuePlanned(
          deps,
          planned.map(({ shot, take, compiled }) => ({
            shot,
            compiled,
            requestedModel: compiled.model.id,
            count: 1,
            /**
             * **系譜は作る瞬間にしか積めない。** 元の試作を親にし、理由を添える。
             * ここで落とすと、その Take は永久に「何の作り直しか」を持たない。
             */
            lineage: { parentTakeId: take.id, regenerationReason: REMAKE_FINAL_REASON },
          })),
        )

    const results = plan.map((entry) =>
      'planned' in entry
        ? {
            shotId: entry.shotId,
            ok: true as const,
            jobIds: [...(jobIdsByShot.get(entry.shotId) ?? [])],
            resolvedModel: entry.planned.compiled.model.id,
            estimatedLatencySec: entry.planned.estimatedLatencySec,
          }
        : { shotId: entry.shotId, ok: false as const, reason: entry.reason },
    )

    const body = ok({
      results,
      enqueuedCount: dryRun ? 0 : planned.length,
      estimatedTotalUsd,
      estimatedTotalLatencySec,
      dryRun,
    })
    return dryRun ? c.json(body, 200) : c.json(body, 202)
  })
