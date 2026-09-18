import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  GenerationJobId as GenerationJobIdSchema,
  ModelId as ModelIdSchema,
  ProjectId as ProjectIdSchema,
  ShotCamera as ShotCameraSchema,
  ShotId as ShotIdSchema,
  ShotStatus as ShotStatusSchema,
  TakeId as TakeIdSchema,
  UpdateShotPatch as UpdateShotPatchSchema,
  checkCostLimits,
  type CostLimits,
  type GenerationJobId,
  type ProjectId,
  type Shot,
  type ShotId,
  type EditBatchEntry,
  type Take,
  type UpdateShotPatch,
} from '@ixa/domain'
import { buildGeneration, type CompiledGeneration } from '@ixa/generation'
import { estimateCostUsd, type VideoModelDescriptor } from '@ixa/provider-core'
import {
  editBatchEntry,
  recordEditBatch,
  shotBeforePatch,
  type EditBatchRecorder,
} from './edit-batch-recording.js'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import {
  MAX_TAKES_PER_REQUEST,
  ShotResponse,
  applySelectedTake,
  costLimitsFor,
  enqueueJobs,
  generationFailureFields,
  generationPorts,
  publishShotStatus,
  toShotResponse,
  type ShotRoutesDeps,
} from './shots.js'

/**
 * Shot の一括操作（tasks/todo.md PHASE 5.8）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * **判断の正は `shots.ts` 側にある。** 仕様の組み立て・コスト判定・採用後の状態遷移は
 * すべて 1 件ずつの経路と同じ関数を呼ぶ（L-016）。ここにあるのは「複数件をどう畳むか」だけ。
 * **結果は必ず 1 件ずつ返す**（L-015）。全体を 1 つの成否に畳むと、
 * 何件が通って何件が残ったのかが画面から消える。
 */

/** 1 回の一括操作で扱える Shot の上限。MV 全体（約 40 Shot）に十分な余裕がある。 */
export const MAX_BULK_SHOT_IDS = 200

export const SHOT_NOT_FOUND_REASON = 'Shot が見つかりません'
export const FOREIGN_SHOT_REASON = 'この Project の Shot ではありません'
export const NO_TAKE_REASON = 'Take がまだありません'
/** `only` は「迷いようがない」ときだけ採用する。複数あるなら人が選ぶ。 */
export const ambiguousTakeReason = (count: number): string =>
  `Take が ${count} 件あります。採用する Take を選んでください`

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

/**
 * 対象の Shot。重複は弾く。同じ Shot を 2 回渡されると生成が 2 倍になり、
 * 見積りと実際の投入数がずれる。
 */
const BulkShotIds = z.array(ShotIdSchema).min(1).max(MAX_BULK_SHOT_IDS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: '同じ Shot を 2 回以上指定できません',
  })

const failedResult = z.object({ shotId: ShotIdSchema, ok: z.literal(false), reason: z.string() })

const BulkGenerateBody = z
  .object({
    shotIds: BulkShotIds,
    model: z.union([ModelIdSchema, z.literal('AUTO')]),
    count: z.number().int().min(1).max(MAX_TAKES_PER_REQUEST).default(1),
  })
  .openapi('BulkGenerateShotsInput')

const BulkGenerateData = z
  .object({
    results: z.array(
      z.discriminatedUnion('ok', [
        z.object({
          shotId: ShotIdSchema, ok: z.literal(true),
          jobIds: z.array(GenerationJobIdSchema), resolvedModel: ModelIdSchema,
        }),
        failedResult,
      ]),
    ),
    /** 投入した分の見積り合計。上限判定はこの値で行う。 */
    estimatedTotalUsd: z.number().nonnegative(),
    /** 投入できた Shot の件数（ジョブ数ではない）。 */
    enqueuedCount: z.number().int().nonnegative(),
  })
  .openapi('BulkGenerateShotsResult')

const BulkSelectTakeBody = z
  .object({
    shotIds: BulkShotIds,
    /** `only`: Take がちょうど 1 件のときだけ採用 / `latest`: 最新の Take を採用。 */
    rule: z.enum(['only', 'latest']),
  })
  .openapi('BulkSelectTakeInput')

const BulkSelectTakeData = z
  .object({
    results: z.array(
      z.discriminatedUnion('ok', [
        z.object({
          shotId: ShotIdSchema, ok: z.literal(true),
          takeId: TakeIdSchema, status: ShotStatusSchema,
        }),
        failedResult,
      ]),
    ),
  })
  .openapi('BulkSelectTakeResult')

/**
 * 一括で変えてよい列。
 *
 * **時間と順序は入れない。** 27 件の `startSec` を一度に揃えると、
 * 重なりだらけのタイムラインを 1 回の操作で作れてしまう。
 * 未知の列は `strict()` で弾く。黙って捨てると「変えたつもり」が残る。
 *
 * **`camera` だけは部分更新。** 「景別だけ変える」で全体を置き換えると、
 * Shot ごとに持っていた `lensMm` や `angle` が 27 件まとめて消える。
 * 送られた項目だけを既存の camera に重ねる（`null` を送れば明示的に外せる）。
 */
const BulkUpdatePatch = UpdateShotPatchSchema.pick({
  mood: true, locationId: true, description: true,
})
  .extend({ camera: ShotCameraSchema.partial().strict().optional() })
  .strict()
  .refine(
    (patch) =>
      Object.keys(patch).length > 0 &&
      (patch.camera === undefined || Object.keys(patch.camera).length > 0),
    { message: '変更する項目を 1 つ以上指定してください' },
  )

const BulkUpdateBody = z
  .object({ shotIds: BulkShotIds, patch: BulkUpdatePatch })
  .openapi('BulkUpdateShotsInput')

const BulkUpdateData = z
  .object({
    results: z.array(
      z.discriminatedUnion('ok', [
        z.object({ shotId: ShotIdSchema, ok: z.literal(true), shot: ShotResponse }),
        failedResult,
      ]),
    ),
  })
  .openapi('BulkUpdateShotsResult')

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('Project が存在しない'),
  422: errorContent('入力の検証に失敗した / 合計見積が上限を超えた'),
  500: errorContent('サーバ内部エラー'),
}

const bulkGenerateRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/shots/bulk/generate', tags: ['shots'],
  summary: '選んだ Shot の生成をまとめて投入する（合計が上限を超えるなら 1 件も投入しない）',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: BulkGenerateBody } } },
  },
  responses: { 202: jsonContent('1 件ずつの結果', successResponse(BulkGenerateData)), ...commonErrors },
})

const bulkSelectTakeRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/shots/bulk/select-take', tags: ['shots'],
  summary: '選んだ Shot の採用 Take をまとめて決める',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: BulkSelectTakeBody } } },
  },
  responses: { 200: jsonContent('1 件ずつの結果', successResponse(BulkSelectTakeData)), ...commonErrors },
})

const bulkUpdateRoute = createRoute({
  method: 'patch', path: '/projects/{projectId}/shots/bulk', tags: ['shots'],
  summary: '選んだ Shot の共通項目をまとめて変える',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: BulkUpdateBody } } },
  },
  responses: { 200: jsonContent('1 件ずつの結果', successResponse(BulkUpdateData)), ...commonErrors },
})

/** 対象として使える Shot か。使えないなら理由を返し、**その 1 件だけ**落とす。 */
type ResolvedShot = { readonly shot: Shot } | { readonly reason: string }

const resolveShot = async (
  deps: Pick<ShotRoutesDeps, 'shots'>, projectId: ProjectId, shotId: ShotId,
): Promise<ResolvedShot> => {
  const shot = await deps.shots.findById(shotId)
  if (shot === null) return { reason: SHOT_NOT_FOUND_REASON }
  if (shot.projectId !== projectId) return { reason: FOREIGN_SHOT_REASON }
  return { shot }
}

/** 1 件ずつの経路が返す 422 の文言を、一括の結果 1 行に畳む。 */
const reasonFromFields = (fields: Record<string, string[]>): string =>
  Object.values(fields).flat().join(' / ')
/** 見積りまで済ませた投入待ちの 1 件。 */
type Planned = {
  readonly shot: Shot
  readonly compiled: CompiledGeneration<VideoModelDescriptor>
  readonly estimatedUsd: number
}

type PlanEntry =
  | { readonly shotId: ShotId; readonly planned: Planned }
  | { readonly shotId: ShotId; readonly reason: string }

/** 一括変更の 1 件。**書く前に決まり切っている**ので、記録も結果もここから作れる。 */
type BulkUpdateStep =
  | { readonly shotId: ShotId; readonly reason: string }
  | {
      readonly shotId: ShotId
      /** 実際に当てる値（`camera` は既存へ重ねたあと）。 */
      readonly next: UpdateShotPatch
      /** その値に対する「変える前」。変わる欄だけを持つ。 */
      readonly before: EditBatchEntry['patch']
    }

const rule = {
  /** ちょうど 1 件のときだけ。0 件と 2 件以上は人に返す。 */
  only: (takes: readonly Take[]): Take | string => {
    const [first] = takes
    if (first === undefined) return NO_TAKE_REASON
    return takes.length === 1 ? first : ambiguousTakeReason(takes.length)
  },
  /** createdAt が最も新しいもの。同時刻なら後から積まれたほうを採る。 */
  latest: (takes: readonly Take[]): Take | string => {
    const latest = takes.reduce<Take | null>(
      (best, take) =>
        best === null || take.createdAt.getTime() >= best.createdAt.getTime() ? take : best,
      null,
    )
    return latest === null ? NO_TAKE_REASON : latest
  },
} as const

/**
 * 一括の口が要る依存。
 *
 * `ShotRoutesDeps`（1 件ずつの口と共有）に、**取り消しのための記録**を足す。
 * 記録を作れない状態で一括変更を通すと、押した瞬間に最大 200 件が戻せなくなる。
 */
export type ShotBulkRoutesDeps = ShotRoutesDeps & {
  readonly editBatches: EditBatchRecorder
}

export const shotBulkRoutes = (deps: ShotBulkRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(bulkGenerateRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { shotIds, model, count } = c.req.valid('json')
      const limits = costLimitsFor(project)
      const projectSpentUsd = await deps.takes.sumCostByProject(project.id)

      /**
       * まず全件を見積もる。**ここでは 1 件も投入しない。**
       * 1 件ずつ投入しながら確かめると、上限に当たった時点で既に投入済みの分が課金される
       * （tasks/todo.md PHASE 5.8「なぜ一括生成はサーバ側でなければならないか」）。
       */
      const plan: PlanEntry[] = []
      for (const shotId of shotIds) {
        const resolved = await resolveShot(deps, projectId, shotId)
        if (!('shot' in resolved)) {
          plan.push({ shotId, reason: resolved.reason })
          continue
        }
        const { shot } = resolved

        let compiled: CompiledGeneration<VideoModelDescriptor>
        try {
          compiled = await buildGeneration(generationPorts(deps), shot, project, model)
        } catch (error) {
          // 知らない失敗は握り潰さない。1 件の不調で全体を 500 にするのが正しい。
          const fields = generationFailureFields(error)
          if (fields === null) throw error
          plan.push({ shotId, reason: reasonFromFields(fields) })
          continue
        }

        const estimatedUsd = estimateCostUsd(compiled.spec, compiled.model) * count
        /**
         * 要求上限と Shot の累積上限は **Shot ごと**に当てる。`maxCostPerRequestUsd` は
         * 「1 Shot への 1 回の依頼」の上限（cost-guard.ts の注記）で、一括はその依頼を
         * N 個まとめた物。合計に当てると実 Provider では 27 件の一括が常に止まる。
         */
        const shotSpentUsd = await deps.takes.sumCostByShot(shot.id)
        const decision = checkCostLimits(limits, { projectSpentUsd, shotSpentUsd }, estimatedUsd)
        if (!decision.allowed) {
          plan.push({ shotId, reason: decision.reason })
          continue
        }
        plan.push({ shotId, planned: { shot, compiled, estimatedUsd } })
      }

      const planned = plan.flatMap((entry) => ('planned' in entry ? [entry.planned] : []))
      const estimatedTotalUsd = planned.reduce((total, p) => total + p.estimatedUsd, 0)

      /**
       * **プロジェクト予算だけは合計で見る。** 超えたら 1 件も投入しない。
       * 要求上限と Shot 上限は上で 1 件ずつ当て済みなので、無限大に差し替えて予算の枝だけ
       * 通す。**規則は写さず、同じ `checkCostLimits` を別の上限で呼ぶ。** 差し替えた値は
       * `CostLimits` の不変条件（Shot 上限 ≤ 予算）に反するのでスキーマでは作れない。
       */
      if (planned.length > 0) {
        const budgetOnly: CostLimits = {
          ...limits,
          maxCostPerRequestUsd: Number.POSITIVE_INFINITY,
          maxCostPerShotUsd: Number.POSITIVE_INFINITY,
        }
        const decision = checkCostLimits(
          budgetOnly,
          { projectSpentUsd, shotSpentUsd: 0 },
          estimatedTotalUsd,
        )
        if (!decision.allowed) {
          // 差し替えにより当たりうるのは予算だけ。上限額はその予算を返す。
          const limitUsd = limits.projectBudgetUsd
          return c.json(
            fail(decision.reason, {
              cost: [decision.limit],
              estimatedTotalUsd: [estimatedTotalUsd.toFixed(3)],
              limitUsd: [limitUsd === null ? '無制限' : limitUsd.toFixed(3)],
            }),
            422,
          )
        }
      }

      const jobIdsByShot = new Map<ShotId, GenerationJobId[]>()
      for (const { shot, compiled } of planned) {
        jobIdsByShot.set(shot.id, await enqueueJobs(deps, shot, compiled, model, count))
        const generating = await deps.shots.updateStatus(shot.id, 'generating')
        // 投入した Shot ごとに流す。1 通にまとめると、どの Shot が動いたか画面に出せない。
        await publishShotStatus(deps, generating)
      }

      const results = plan.map((entry) =>
        'planned' in entry
          ? {
              shotId: entry.shotId,
              ok: true as const,
              jobIds: jobIdsByShot.get(entry.shotId) ?? [],
              resolvedModel: entry.planned.compiled.model.id,
            }
          : { shotId: entry.shotId, ok: false as const, reason: entry.reason },
      )

      return c.json(ok({ results, estimatedTotalUsd, enqueuedCount: planned.length }), 202)
    })

    .openapi(bulkSelectTakeRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      const body = c.req.valid('json')
      const pick = rule[body.rule]

      const results = []
      for (const shotId of body.shotIds) {
        const resolved = await resolveShot(deps, projectId, shotId)
        if (!('shot' in resolved)) {
          results.push({ shotId, ok: false as const, reason: resolved.reason })
          continue
        }
        const chosen = pick(await deps.takes.findByShot(resolved.shot.id))
        if (typeof chosen === 'string') {
          results.push({ shotId, ok: false as const, reason: chosen })
          continue
        }
        // 状態遷移は 1 件ずつの採用と同じ関数に任せる。
        const updated = await applySelectedTake(deps, resolved.shot.id, chosen)
        results.push({ shotId, ok: true as const, takeId: chosen.id, status: updated.status })
      }

      return c.json(ok({ results }), 200)
    })

    .openapi(bulkUpdateRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      const { shotIds, patch } = c.req.valid('json')

      /**
       * **書く前に、全件ぶんの「変える前」を集める。** 書きながら集めると、
       * 途中で落ちたときに記録の無い変更が残る。
       */
      const steps: BulkUpdateStep[] = []
      for (const shotId of shotIds) {
        const resolved = await resolveShot(deps, projectId, shotId)
        if (!('shot' in resolved)) {
          steps.push({ shotId, reason: resolved.reason })
          continue
        }
        // camera は Shot ごとに既存の値へ重ねる。全体の置換にしない。
        const { camera, ...rest } = patch
        const next =
          camera === undefined ? rest : { ...rest, camera: { ...resolved.shot.camera, ...camera } }
        steps.push({ shotId, next, before: shotBeforePatch(resolved.shot, next) })
      }

      await recordEditBatch(deps.editBatches, {
        projectId,
        kind: 'bulk_update',
        summarize: (count) => `Shot を ${count.toString()} 件まとめて変更しました`,
        entries: steps.flatMap((step) =>
          'reason' in step ? [] : [editBatchEntry(step.shotId, step.before)],
        ),
      })

      const results = []
      for (const step of steps) {
        if ('reason' in step) {
          results.push({ shotId: step.shotId, ok: false as const, reason: step.reason })
          continue
        }
        const updated = await deps.shots.update(step.shotId, step.next)
        results.push({ shotId: step.shotId, ok: true as const, shot: toShotResponse(updated) })
      }

      return c.json(ok({ results }), 200)
    })
