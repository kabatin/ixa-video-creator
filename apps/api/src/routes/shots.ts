import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  GenerationJobRepository, ProjectRepository, ShotRepository, TakeRepository,
} from '@ixa/db'
import {
  CreateShotInput as CreateShotInputSchema,
  GenerationJobId as GenerationJobIdSchema,
  ModelId as ModelIdSchema,
  ProjectId as ProjectIdSchema,
  Shot as ShotSchema,
  ShotId as ShotIdSchema,
  Take as TakeSchema,
  TakeId as TakeIdSchema,
  UpdateShotPatch as UpdateShotPatchSchema,
  compileSpec,
  computeSpecHash,
  quantizeDuration,
  resolveReferences,
  type GenerationContextSource,
  GenerationJob as GenerationJobSchema,
  type GenerationJob,
  type GenerationJobId,
  type ModelId,
  type Project,
  type ReferenceRole,
  type RouterDecision,
  type Shot,
  type ShotGenerationSpec,
  type Take,
  CostLimits as CostLimitsSchema,
  DEFAULT_COST_LIMITS,
  checkCostLimits,
  type CostLimits,
  DurationNotSupportedError,
} from '@ixa/domain'
import { GenerationContextError } from '@ixa/generation'
import {
  selectModel,
  validateAgainstCapabilities,
  type ProviderRegistry,
  type VideoModelDescriptor,
  estimateCostUsd,
  NoEligibleModelError,
  UnknownModelError,
} from '@ixa/provider-core'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Shot の CRUD と生成ジョブの投入（docs/ARCHITECTURE.md §11 / §18）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 */

/** BullMQ のキュー名（docs/ARCHITECTURE.md §20）。apps 同士を import しないため定数で持つ。 */
export const GENERATION_QUEUE_NAME = 'generation'

/** 1 回の要求で作れる Take の上限。超えたら 422。 */
export const MAX_TAKES_PER_REQUEST = 4

/** 生成ジョブをキューへ投入する Port。Redis への依存を main.ts に閉じ込める。 */
export type GenerationQueue = {
  /** ジョブデータは ID のみ。実データは DB から読む（ADR-0008）。 */
  enqueue(generationJobId: GenerationJobId): Promise<void>
}

export const ShotResponse = ShotSchema.omit({ createdAt: true, updatedAt: true, lockedAt: true })
  .extend({
    lockedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Shot')
export type ShotResponse = z.infer<typeof ShotResponse>

export const toShotResponse = (shot: Shot): ShotResponse => ({
  ...shot,
  lockedAt: shot.lockedAt === null ? null : shot.lockedAt.toISOString(),
  createdAt: shot.createdAt.toISOString(),
  updatedAt: shot.updatedAt.toISOString(),
})

export const TakeResponse = TakeSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('Take')
export type TakeResponse = z.infer<typeof TakeResponse>

export const toTakeResponse = (take: Take): TakeResponse => ({
  ...take,
  createdAt: take.createdAt.toISOString(),
})

const GenerateBody = z
  .object({
    model: z.union([ModelIdSchema, z.literal('AUTO')]),
    count: z.number().int().min(1).max(MAX_TAKES_PER_REQUEST).default(1),
  })
  .openapi('GenerateShotInput')

const GenerateData = z
  .object({
    jobIds: z.array(GenerationJobIdSchema),
    specHash: z.string().length(64),
    resolvedModel: ModelIdSchema,
    /**
     * 同じ specHash の Take が既にある場合の警告。生成自体は止めない
     * （ARCHITECTURE.md §11 のコストガード）。
     */
    duplicateOfTakeId: TakeIdSchema.nullable(),
  })
  .openapi('GenerateShotResult')

const SelectTakeBody = z.object({ takeId: TakeIdSchema }).openapi('SelectTakeInput')

/**
 * 生成ジョブの状態。UI が「生成が終わったか」を判定するために必要。
 * Take の本数で推測すると、失敗したジョブを待ち続けることになる。
 */
export const GenerationJobResponse = GenerationJobSchema.omit({
  queuedAt: true, startedAt: true, finishedAt: true,
})
  .extend({
    queuedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('GenerationJob')
export type GenerationJobResponse = z.infer<typeof GenerationJobResponse>

export const toGenerationJobResponse = (job: GenerationJob): GenerationJobResponse => ({
  ...job,
  queuedAt: job.queuedAt.toISOString(),
  startedAt: job.startedAt === null ? null : job.startedAt.toISOString(),
  finishedAt: job.finishedAt === null ? null : job.finishedAt.toISOString(),
})

const GenerationJobParams = z.object({
  id: GenerationJobIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

const ShotParams = z.object({
  id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const CreateShotBody = CreateShotInputSchema.omit({ projectId: true }).openapi('CreateShotInput')
const UpdateShotBody = UpdateShotPatchSchema.pick({
  description: true, camera: true, sourceType: true,
  startSec: true, durationSec: true, sourceInSec: true,
}).openapi('UpdateShotPatch')

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const listShotsRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/shots', tags: ['shots'],
  summary: 'プロジェクト内の Shot 一覧（order 昇順）',
  request: { params: ProjectParams },
  responses: { 200: jsonContent('Shot 一覧', listResponse(ShotResponse)), ...commonErrors },
})

const getShotRoute = createRoute({
  method: 'get', path: '/shots/{id}', tags: ['shots'],
  summary: 'Shot を 1 件取得する',
  request: { params: ShotParams },
  responses: { 200: jsonContent('Shot', successResponse(ShotResponse)), ...commonErrors },
})

const getGenerationJobRoute = createRoute({
  method: 'get', path: '/generation-jobs/{id}', tags: ['shots'],
  summary: '生成ジョブの状態を取得する',
  request: { params: GenerationJobParams },
  responses: {
    200: jsonContent('生成ジョブ', successResponse(GenerationJobResponse)),
    ...commonErrors,
  },
})

const createShotRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/shots', tags: ['shots'],
  summary: 'Shot を作成する',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: CreateShotBody } } },
  },
  responses: { 201: jsonContent('作成された Shot', successResponse(ShotResponse)), ...commonErrors },
})

const updateShotRoute = createRoute({
  method: 'patch', path: '/shots/{id}', tags: ['shots'],
  summary: 'Shot を部分更新する',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: UpdateShotBody } } },
  },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

const deleteShotRoute = createRoute({
  method: 'delete', path: '/shots/{id}', tags: ['shots'],
  summary: 'Shot をソフトデリートする',
  request: { params: ShotParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

const generateRoute = createRoute({
  method: 'post', path: '/shots/{id}/generate', tags: ['shots'],
  summary: '生成仕様を組み立てて generation キューへ投入する',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: GenerateBody } } },
  },
  responses: {
    202: jsonContent('投入されたジョブ', successResponse(GenerateData)),
    ...commonErrors,
  },
})

const listTakesRoute = createRoute({
  method: 'get', path: '/shots/{id}/takes', tags: ['shots'],
  summary: 'Shot の Take 一覧（index 昇順）',
  request: { params: ShotParams },
  responses: { 200: jsonContent('Take 一覧', listResponse(TakeResponse)), ...commonErrors },
})

const selectTakeRoute = createRoute({
  method: 'post', path: '/shots/{id}/select-take', tags: ['shots'],
  summary: '採用 Take を決める',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: SelectTakeBody } } },
  },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

export type ShotRoutesDeps = {
  shots: ShotRepository
  projects: ProjectRepository
  takes: TakeRepository
  generationJobs: GenerationJobRepository
  registry: ProviderRegistry
  context: GenerationContextSource
  queue: GenerationQueue
}

/** 組み上がった生成仕様と、それを出したモデル。 */
type CompiledGeneration = {
  readonly spec: ShotGenerationSpec
  readonly specHash: string
  readonly model: VideoModelDescriptor
  readonly routerDecision: RouterDecision | null
}

/** 仕様を組めない理由。呼び出し側が 422 へ変換する。 */
export class SpecCompilationError extends Error {
  override readonly name = 'SpecCompilationError'
}

const unionCapabilities = (models: readonly VideoModelDescriptor[]) => ({
  maxReferences: Math.max(0, ...models.map((m) => m.capabilities.referenceImages.max)),
  supportedRoles: [
    ...new Set(models.flatMap((m): readonly ReferenceRole[] => m.capabilities.referenceImages.roles)),
  ],
})

/**
 * Shot・Project・参照から生成仕様を組み立てる。
 *
 * AUTO のときはモデルが決まるまで参照枚数も生成尺も確定できないため、
 * まず全モデルの能力の和で下書きを作って selectModel に渡し、
 * 選ばれたモデルの能力で組み直す。最終的な specHash は 2 周目のものだけを使う。
 */
export const buildGeneration = async (
  deps: Pick<ShotRoutesDeps, 'context' | 'registry'>,
  shot: Shot,
  project: Project,
  requestedModel: ModelId | 'AUTO',
): Promise<CompiledGeneration> => {
  const candidates =
    requestedModel === 'AUTO'
      ? deps.registry.allModels()
      : [deps.registry.findModel(requestedModel)]
  if (candidates.length === 0) throw new SpecCompilationError('利用できるモデルがありません')

  const [characters, locations, manualReferences, previousShotLastFrameId, startFrameId] =
    await Promise.all([
      deps.context.charactersForShot(shot.id),
      deps.context.locationsForShot(shot.id),
      deps.context.manualReferencesForShot(shot.id),
      deps.context.previousShotLastFrame(shot.id),
      deps.context.startFrame(shot.id),
    ])

  const compileFor = (
    maxReferences: number,
    supportedRoles: readonly ReferenceRole[],
    generationDurationSec: number,
  ): ShotGenerationSpec => {
    const references = resolveReferences({
      characters, locations, manualReferences,
      previousShotLastFrameId, startFrameId, maxReferences, supportedRoles,
    })
    return compileSpec({
      project, shot, characters, references, generationDurationSec,
      seed: null, negativePrompt: null,
    })
  }

  let chosen = candidates[0] as VideoModelDescriptor
  let routerDecision: RouterDecision | null = null

  if (requestedModel === 'AUTO') {
    const union = unionCapabilities(candidates)
    // 下書きの尺は編集尺のまま渡す。selectModel はモデルごとに切り上げて見積もる。
    const draft = compileFor(union.maxReferences, union.supportedRoles, shot.durationSec)
    routerDecision = selectModel(draft, candidates)
    chosen = deps.registry.findModel(routerDecision.modelId)
  }

  const caps = chosen.capabilities
  const spec = compileFor(
    caps.referenceImages.max,
    caps.referenceImages.roles,
    quantizeDuration(shot.durationSec, caps.durations),
  )

  const violations = validateAgainstCapabilities(spec, chosen)
  if (violations.length > 0) {
    throw new SpecCompilationError(`モデル ${chosen.id} では生成できません: ${violations.join(' / ')}`)
  }

  return { spec, specHash: await computeSpecHash(spec), model: chosen, routerDecision }
}

/**
 * プロジェクトの設定からコスト上限を作る。
 * Project.budgetUsd が未設定なら無制限だが、Shot と要求の上限は常に効く。
 */
export const costLimitsFor = (project: Pick<Project, 'budgetUsd'>): CostLimits =>
  CostLimitsSchema.parse({
    ...DEFAULT_COST_LIMITS,
    projectBudgetUsd: project.budgetUsd,
    // 予算が既定の Shot 上限より小さい場合、不変条件（Shot ≤ 予算）を満たすよう下げる
    maxCostPerShotUsd:
      project.budgetUsd === null
        ? DEFAULT_COST_LIMITS.maxCostPerShotUsd
        : Math.min(DEFAULT_COST_LIMITS.maxCostPerShotUsd, project.budgetUsd),
    maxCostPerRequestUsd:
      project.budgetUsd === null
        ? DEFAULT_COST_LIMITS.maxCostPerRequestUsd
        : Math.min(DEFAULT_COST_LIMITS.maxCostPerRequestUsd, project.budgetUsd),
  })

/** GenerationJob 行を作りつつキューへ入れる。DB が真実、キューは実行手段（ADR-0008）。 */
const enqueueJobs = async (
  deps: Pick<ShotRoutesDeps, 'generationJobs' | 'queue'>,
  shot: Shot,
  compiled: CompiledGeneration,
  requestedModel: ModelId | 'AUTO',
  count: number,
): Promise<GenerationJobId[]> => {
  const created: GenerationJobId[] = []
  for (let i = 0; i < count; i += 1) {
    const job = await deps.generationJobs.create({
      shotId: shot.id,
      specHash: compiled.specHash,
      requestedModel,
      resolvedModel: compiled.model.id,
      routerDecision: compiled.routerDecision,
    })
    await deps.queue.enqueue(job.id)
    created.push(job.id)
  }
  return created
}

export const shotRoutes = (deps: ShotRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listShotsRoute, async (c) => {
      const found = await deps.shots.findByProject(c.req.valid('param').projectId)
      return c.json(okList(found.map(toShotResponse)), 200)
    })
    .openapi(getShotRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toShotResponse(shot)), 200)
    })
    .openapi(getGenerationJobRoute, async (c) => {
      const job = await deps.generationJobs.findById(c.req.valid('param').id)
      if (job === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toGenerationJobResponse(job)), 200)
    })
    .openapi(createShotRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const created = await deps.shots.create({ ...c.req.valid('json'), projectId })
      return c.json(ok(toShotResponse(created)), 201)
    })
    .openapi(updateShotRoute, async (c) => {
      const updated = await deps.shots.update(c.req.valid('param').id, c.req.valid('json'))
      return c.json(ok(toShotResponse(updated)), 200)
    })
    .openapi(deleteShotRoute, async (c) => {
      await deps.shots.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
    .openapi(listTakesRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const found = await deps.takes.findByShot(shot.id)
      return c.json(okList(found.map(toTakeResponse)), 200)
    })
    .openapi(selectTakeRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const take = await deps.takes.findById(c.req.valid('json').takeId)
      // 他 Shot の Take を採用させない。Take は Shot に属する（DOMAIN.md §10）。
      if (take === null || take.shotId !== shot.id) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { takeId: ['この Shot に属する Take ではありません'] }),
          422,
        )
      }

      await deps.shots.selectTake(shot.id, take.id)
      const updated = await deps.shots.updateStatus(
        shot.id,
        take.humanVerdict === 'approved' ? 'approved' : 'review',
      )
      return c.json(ok(toShotResponse(updated)), 200)
    })
    .openapi(generateRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const project = await deps.projects.findById(shot.projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { model, count } = c.req.valid('json')

      let compiled: CompiledGeneration
      try {
        compiled = await buildGeneration(deps, shot, project, model)
      } catch (error) {
        /**
         * **知っている失敗だけを 422 に畳む。**
         * 以前はここで `Error` を丸ごと捕まえていたため、DB の接続断まで
         * 「モデルが不正」として 422 で返ってしまい、障害が入力ミスに見えていた。
         * 未知の例外は握り潰さず投げ直し、500 として扱う。
         */
        if (error instanceof GenerationContextError) {
          // Shot が実在しない Character / Look を指している。モデルの問題ではない。
          return c.json(fail(VALIDATION_ERROR_MESSAGE, { characters: [error.message] }), 422)
        }
        // モデルが選べない・要求を満たせない・尺が出せない、は入力の問題。
        if (
          error instanceof SpecCompilationError ||
          error instanceof DurationNotSupportedError ||
          error instanceof NoEligibleModelError ||
          error instanceof UnknownModelError
        ) {
          return c.json(fail(VALIDATION_ERROR_MESSAGE, { model: [error.message] }), 422)
        }
        throw error
      }

      /**
       * コスト上限を確認する。**キューへ投入する前に止める**（ADR / ARCHITECTURE.md §11）。
       * 投入してから worker が失敗するより、投入しないほうが利用者に分かりやすい。
       *
       * スタブはコスト 0 なので Phase 1 では発動しない。
       * 実 Provider に切り替えた瞬間に効く必要があるため、先に配線しておく。
       */
      const estimated = estimateCostUsd(compiled.spec, compiled.model) * count
      const [projectSpentUsd, shotSpentUsd] = await Promise.all([
        deps.takes.sumCostByProject(project.id),
        deps.takes.sumCostByShot(shot.id),
      ])
      const limits = costLimitsFor(project)
      const decision = checkCostLimits(limits, { projectSpentUsd, shotSpentUsd }, estimated)
      if (!decision.allowed) {
        return c.json(fail(decision.reason, { cost: [decision.limit] }), 422)
      }

      // 同一仕様の Take が既にあれば警告する。生成は止めない（ARCHITECTURE.md §11）。
      const existing = await deps.takes.findByShot(shot.id)
      const duplicate = existing.find((t) => t.specHash === compiled.specHash) ?? null

      const jobIds = await enqueueJobs(deps, shot, compiled, model, count)
      await deps.shots.updateStatus(shot.id, 'generating')

      return c.json(
        ok({
          jobIds,
          specHash: compiled.specHash,
          resolvedModel: compiled.model.id,
          duplicateOfTakeId: duplicate === null ? null : duplicate.id,
        }),
        202,
      )
    })
