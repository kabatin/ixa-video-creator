import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  GenerationJobRepository,
  LocationRepository,
  ProjectRepository,
  ShotRepository,
  TakeRepository,
} from '@ixa/db'
import {
  GenerationJobId as GenerationJobIdSchema,
  ModelId as ModelIdSchema,
  ProjectId as ProjectIdSchema,
  Shot as ShotSchema,
  ShotId as ShotIdSchema,
  Take as TakeSchema,
  lineagePairViolation,
  TakeId as TakeIdSchema,
  type TakeId,
  type GenerationContextSource,
  GenerationJob as GenerationJobSchema,
  type GenerationJob,
  type GenerationJobId,
  type ModelId,
  type Project,
  type ProviderId,
  type Shot,
  type ShotId,
  type Take,
  CostLimits as CostLimitsSchema,
  type ProjectEventPublisher,
  DEFAULT_COST_LIMITS,
  checkCostLimits,
  type CostLimits,
  DurationNotSupportedError,
  Corrections as CorrectionsSchema,
  settledShotStatus,
  stretchesToFit,
} from '@ixa/domain'
import {
  GenerationContextError,
  SpecCompilationError,
  buildGeneration,
  catalogForVideoChoice,
  type BuildGenerationDeps,
  type CompiledGeneration,
} from '@ixa/generation'
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
import type { Logger } from '../logger.js'
import {
  errorContent,
  fail,
  listResponse,
  ok,
  okList,
  successResponse,
  type FieldErrors,
} from '../response.js'

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
    /**
     * レビューの指摘から人が選んだ直し（PHASE 6.1）。
     *
     * 上限（件数・1 件の長さ）は domain の `Corrections` が持つ。**ここで書き写さない。**
     * 二重に書くと必ずズレて、画面では通るのに API で落ちる入力が生まれる。
     */
    corrections: CorrectionsSchema.default([]),
    /**
     * 作り直しの元になる Take（ADR-0042 の「本番で作り直す」）。
     *
     * **Take は作る瞬間にしか系譜を持てない**（`parent_take_id` を後から UPDATE できない。
     * `apps/worker/src/generation/lineage.ts`）。だから依頼の時点で渡す。
     * 列も worker の処理も前からあるが、**書く側がここまで無かった**。
     */
    parentTakeId: TakeIdSchema.optional(),
    /** なぜ作り直すのか。**親を渡すなら必須**（domain の `lineagePairViolation` と同じ規則）。 */
    regenerationReason: z.string().trim().min(1).max(200).optional(),
    /**
     * 使うシード（ADR-0042 の「本番で作り直す」）。**省略は Provider に任せる**（従来どおり）。
     *
     * 上限はここで決めない。Provider ごとに違う（Wan には `WAN_MAX_SEED` がある）ので、
     * **その Provider が断る**。ここでは「負でない整数」だけを見る。
     */
    seed: z.number().int().nonnegative().optional(),
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
    /**
     * モデルの最長より長い Shot を最長で作り、Shot を「Take を尺に合わせる」にした。
     * 画面はこれを見て「少しゆっくり再生して埋めます」と言う。
     */
    stretchedToFit: z.boolean(),
  })
  .openapi('GenerateShotResult')

/**
 * 生成ジョブの状態。UI が「生成が終わったか」を判定するために必要。
 * Take の本数で推測すると、失敗したジョブを待ち続けることになる。
 */
export const GenerationJobResponse = GenerationJobSchema.omit({
  queuedAt: true,
  startedAt: true,
  providerStartedAt: true,
  finishedAt: true,
})
  .extend({
    queuedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    providerStartedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
  })
  .openapi('GenerationJob')
export type GenerationJobResponse = z.infer<typeof GenerationJobResponse>

export const toGenerationJobResponse = (job: GenerationJob): GenerationJobResponse => ({
  ...job,
  queuedAt: job.queuedAt.toISOString(),
  startedAt: job.startedAt === null ? null : job.startedAt.toISOString(),
  providerStartedAt: job.providerStartedAt === null ? null : job.providerStartedAt.toISOString(),
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
  method: 'get',
  path: '/projects/{projectId}/shots',
  tags: ['shots'],
  summary: 'プロジェクト内の Shot 一覧（order 昇順）',
  request: { params: ProjectParams },
  responses: { 200: jsonContent('Shot 一覧', listResponse(ShotResponse)), ...commonErrors },
})

const getShotRoute = createRoute({
  method: 'get',
  path: '/shots/{id}',
  tags: ['shots'],
  summary: 'Shot を 1 件取得する',
  request: { params: ShotParams },
  responses: { 200: jsonContent('Shot', successResponse(ShotResponse)), ...commonErrors },
})

const getGenerationJobRoute = createRoute({
  method: 'get',
  path: '/generation-jobs/{id}',
  tags: ['shots'],
  summary: '生成ジョブの状態を取得する',
  request: { params: GenerationJobParams },
  responses: {
    200: jsonContent('生成ジョブ', successResponse(GenerationJobResponse)),
    ...commonErrors,
  },
})

const generateRoute = createRoute({
  method: 'post',
  path: '/shots/{id}/generate',
  tags: ['shots'],
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
  method: 'get',
  path: '/shots/{id}/takes',
  tags: ['shots'],
  summary: 'Shot の Take 一覧（index 昇順）',
  request: { params: ShotParams },
  responses: { 200: jsonContent('Take 一覧', listResponse(TakeResponse)), ...commonErrors },
})

export type ShotRoutesDeps = {
  shots: ShotRepository
  projects: ProjectRepository
  /** Shot に付けるロケーションが同じプロジェクトのものかを確かめる（ADR-0034）。 */
  locations: Pick<LocationRepository, 'findById'>
  takes: TakeRepository
  generationJobs: GenerationJobRepository
  registry: ProviderRegistry
  /** いま選んでいる動画の AI（ADR-0032）。**AUTO はこの中から選ぶ。** 生成するたびに呼ぶ。 */
  videoProvider: () => Promise<ProviderId>
  context: GenerationContextSource
  queue: GenerationQueue
  /** 状態を変えた瞬間に出来事を流す先（PHASE 5.8b）。配信の実体は main.ts が注入する。 */
  events: ProjectEventPublisher
  logger: Logger
}

/**
 * `buildGeneration`（packages/generation）へ渡す Port を組み立てる。
 *
 * 仕様の組み立てとモデル選択は **api と worker の両方が同じ実装を使う**必要がある
 * （片方だけ差し替えると spec_drift で全滅する / tasks/lessons.md L-012）。
 * そのためロジックは packages 側にあり、ここは provider-core の実装を
 * 構造的な Port に差し込むだけの配線に徹する。
 */
export const generationPorts = async (
  deps: Pick<ShotRoutesDeps, 'context' | 'registry' | 'videoProvider'>,
): Promise<BuildGenerationDeps<VideoModelDescriptor>> => ({
  context: deps.context,
  // AUTO は「使う AI」で選んだ動画の AI の中から（明示したモデルはそのまま引ける）。
  catalog: catalogForVideoChoice(deps.registry, await deps.videoProvider()),
  router: { selectModel, validateAgainstCapabilities },
})

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

/**
 * モデルの最長より短く作るなら、Shot を「Take を尺に合わせる」にする（ゆっくり再生して埋める。ADR-0026）。
 * 制作者 2026-10-01「ミリ秒まで一致しないと作れないのは不便すぎる」。
 * `timing` は仕様（specHash）に入らないので、worker の組み立てと食い違わない。伸ばすなら true。
 */
export const fitTimingWhenStretched = async (
  deps: Pick<ShotRoutesDeps, 'shots'>,
  shot: Shot,
  compiled: CompiledGeneration<VideoModelDescriptor>,
): Promise<boolean> => {
  // 比べるのは編集尺（速さを掛ける前）。速めた trim の Shot は fit にしない（再生が足りる速さまで落ちる。
  // ここで fit に替えると worker の組み直しが別の長さになり spec_drift で落ちる）。
  if (!stretchesToFit(shot.durationSec, compiled.spec.durationSec)) return false
  if (shot.timing !== 'fit') await deps.shots.update(shot.id, { timing: 'fit' })
  return true
}

/**
 * 作り直しの系譜を確かめる（ADR-0042 の「本番で作り直す」）。
 *
 * - 親を渡すなら**理由も必須**（domain の `lineagePairViolation` と同じ規則を、ここでも同じ関数で見る）
 * - 親は**その Shot の Take**であること。別の Shot の Take を親にすると系譜が壊れる
 * - 見えなくした Take も親にできる（作り直しの元が消されていても、記録としては正しい）
 */
export const resolveLineage = async (
  deps: Pick<ShotRoutesDeps, 'takes'>,
  shot: Shot,
  parentTakeId: TakeId | undefined,
  regenerationReason: string | undefined,
): Promise<
  | { readonly ok: true; readonly value: { parentTakeId: TakeId; regenerationReason: string } | null }
  | { readonly ok: false; readonly fields: Record<string, string[]> }
> => {
  if (parentTakeId === undefined) {
    return regenerationReason === undefined
      ? { ok: true, value: null }
      : { ok: false, fields: { parentTakeId: ['作り直しの理由だけでは作り直せません（元の Take も渡してください）'] } }
  }
  const violation = lineagePairViolation({
    parentTakeId,
    regenerationReason: regenerationReason ?? null,
  })
  if (violation !== null) return { ok: false, fields: { regenerationReason: [violation] } }

  const parent = await deps.takes.findById(parentTakeId, { includeHidden: true })
  if (parent === null || parent.shotId !== shot.id) {
    return { ok: false, fields: { parentTakeId: ['この Shot に属する Take ではありません'] } }
  }
  return { ok: true, value: { parentTakeId, regenerationReason: regenerationReason as string } }
}

/** GenerationJob 行を作りつつキューへ入れる。DB が真実、キューは実行手段（ADR-0008）。 */
export const enqueueJobs = async (
  deps: Pick<ShotRoutesDeps, 'generationJobs' | 'queue'>,
  shot: Shot,
  compiled: CompiledGeneration<VideoModelDescriptor>,
  requestedModel: ModelId | 'AUTO',
  count: number,
  corrections: readonly string[] = [],
  /**
   * 作り直しの系譜。**行に積む。** Take は作る瞬間にしか親を持てないので、
   * ここで落とすとその Take は永久に系譜を持たない（`generation/lineage.ts`）。
   */
  lineage: { readonly parentTakeId: TakeId; readonly regenerationReason: string } | null = null,
): Promise<GenerationJobId[]> => {
  const created: GenerationJobId[] = []
  for (let i = 0; i < count; i += 1) {
    const job = await deps.generationJobs.create({
      shotId: shot.id,
      specHash: compiled.specHash,
      requestedModel,
      resolvedModel: compiled.model.id,
      routerDecision: compiled.routerDecision,
      /**
       * **直しは行に積む。** worker は行から読み直して仕様を組み直すので、
       * ここで積み忘れると `specHash` が食い違って `spec_drift` で落ちる（L-012）。
       */
      corrections: [...corrections],
      /**
       * **シードも行に積む。** worker は行から読んで仕様を組み直すので、
       * 積み忘れると `specHash` が食い違って `spec_drift` で落ちる（直しと同じ。L-012）。
       */
      seed: compiled.spec.seed,
      ...(lineage === null ? {} : lineage),
    })
    await deps.queue.enqueue(job.id)
    created.push(job.id)
  }
  return created
}

/**
 * Shot の状態が変わったことを流す（tasks/todo.md PHASE 5.8b）。
 *
 * **失敗しても呼び出し元の処理を止めない。** 通知は状態変更への上乗せで、
 * 通知が落ちたからといって採用や投入を巻き戻すことはない（domain の
 * `ProjectEventPublisher` の約束）。**ただし黙って捨てない。** 必ずログに残す。
 */
export const publishShotStatus = async (
  deps: Pick<ShotRoutesDeps, 'events' | 'logger'>,
  shot: Pick<Shot, 'id' | 'projectId' | 'status'>,
): Promise<void> => {
  try {
    await deps.events.publish({
      type: 'shot.status',
      projectId: shot.projectId,
      shotId: shot.id,
      status: shot.status,
      at: new Date().toISOString(),
    })
  } catch (error) {
    deps.logger.warn(
      { err: error, shotId: shot.id, status: shot.status },
      'Shot の状態変化を配信できませんでした',
    )
  }
}

/**
 * 採用 Take を確定し、Shot の状態を進める。
 *
 * **1 件ずつの採用と一括採用で同じ判断を使う**（tasks/lessons.md L-016）。
 *
 * **採用が決定。** Take を採用したら Shot は `approved`（画面では「採用済み」）。
 * 以前は採用した Take に人の承認（`humanVerdict`）が付いていない限り `review` のままで、
 * 採用しても状態列が「レビュー待ち」から動かなかった。承認の操作はインスペクター最下部に
 * 1 件ずつしか無く、しかも書き出しには要らない。人がいちばん意思を込める操作は
 * 「どの Take を使うか」なので、それを決定として扱う（ADR-0023）。
 */
export const applySelectedTake = async (
  deps: Pick<ShotRoutesDeps, 'shots' | 'events' | 'logger'>,
  shotId: ShotId,
  take: Pick<Take, 'id'>,
): Promise<Shot> => {
  const updated = await settleSelectedTake(deps.shots, shotId, take)
  await publishShotStatus(deps, updated)
  return updated
}

/**
 * 採用を書くだけ（出来事は流さない）。**トランザクションの中ではこちらを使い、確定した後に流す**（2026-10-19 のレビュー）。
 * 中で流すと、巻き戻した・確定する前の状態が画面に出る。
 */
export const settleSelectedTake = async (
  shots: Pick<ShotRepository, 'selectTake' | 'updateStatus'>,
  shotId: ShotId,
  take: Pick<Take, 'id'>,
): Promise<Shot> => {
  await shots.selectTake(shotId, take.id)
  // 判断は domain の 1 箇所（worker の成功・失敗と同じ関数を引く）。
  return shots.updateStatus(shotId, settledShotStatus({ hasSelectedTake: true, hasTakes: true }))
}

/**
 * 採用を外す（PHASE 8）。**Take は追記のみで消さない**（規約 2）。外すのは Shot の指し先だけ。
 * Take が残っているので状態は `review`（Take はあるが採用前）へ戻す。
 * 生成中の Shot は触らない（生成が終われば状態は worker が進める）。
 */
export const clearSelectedTake = async (
  deps: Pick<ShotRoutesDeps, 'shots' | 'events' | 'logger'>,
  shot: Shot,
): Promise<Shot> => {
  if (shot.selectedTakeId === null) return shot
  const updated = await settleClearedTake(deps.shots, shot)
  await publishShotStatus(deps, updated)
  return updated
}

/** 採用を外して書くだけ（出来事は流さない。`settleSelectedTake` と同じく、確定した後に流す）。 */
export const settleClearedTake = async (
  shots: Pick<ShotRepository, 'findById' | 'selectTake' | 'updateStatus'>,
  shot: Shot,
): Promise<Shot> => {
  if (shot.selectedTakeId === null) return shot
  await shots.selectTake(shot.id, null)
  const updated =
    shot.status === 'generating'
      ? await shots.findById(shot.id)
      : await shots.updateStatus(shot.id, settledShotStatus({ hasSelectedTake: false, hasTakes: true }))
  if (updated === null) throw new Error(`採用を外した Shot が見つかりません: ${shot.id}`)
  return updated
}

/**
 * `buildGeneration` の**知っている失敗だけ**をフィールド単位の 422 へ畳む。
 * 未知の失敗は `null` を返す。呼び出し側は投げ直して 500 にすること
 * （DB の接続断を「モデルが不正」として返さないため）。
 *
 * 1 件ずつの生成と一括生成が同じ切り分けを使う（tasks/lessons.md L-016）。
 */
export const generationFailureFields = (error: unknown): FieldErrors | null => {
  // Shot が実在しない Character / Look を指している。モデルの問題ではない。
  if (error instanceof GenerationContextError) return { characters: [error.message] }
  // モデルが選べない・要求を満たせない・尺が出せない、は入力の問題。
  if (
    error instanceof SpecCompilationError ||
    error instanceof DurationNotSupportedError ||
    error instanceof NoEligibleModelError ||
    error instanceof UnknownModelError
  ) {
    return { model: [error.message] }
  }
  return null
}

/** 1 件ずつの直し・採用を、書く前に記録する（取り消し。2026-10-19）。 */
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
    .openapi(listTakesRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const found = await deps.takes.findByShot(shot.id)
      return c.json(okList(found.map(toTakeResponse)), 200)
    })
    .openapi(generateRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const project = await deps.projects.findById(shot.projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { model, count, corrections, parentTakeId, regenerationReason, seed } = c.req.valid('json')

      /**
       * 作り直しの系譜（ADR-0042）。**組み立ての前に確かめる。**
       * 親がこの Shot のものでなければ、別の Shot の Take を親に持つ Take ができる。
       */
      const lineage = await resolveLineage(deps, shot, parentTakeId, regenerationReason)
      if (lineage.ok === false) return c.json(fail(VALIDATION_ERROR_MESSAGE, lineage.fields), 422)

      let compiled: CompiledGeneration<VideoModelDescriptor>
      try {
        compiled = await buildGeneration(await generationPorts(deps), shot, project, model, {
          corrections,
          // 省略は「Provider に任せる」。**0 は正当なシード**なので `?? null` で畳まない。
          ...(seed === undefined ? {} : { seed }),
        })
      } catch (error) {
        /**
         * **知っている失敗だけを 422 に畳む。**
         * 以前はここで `Error` を丸ごと捕まえていたため、DB の接続断まで
         * 「モデルが不正」として 422 で返ってしまい、障害が入力ミスに見えていた。
         * 未知の例外は握り潰さず投げ直し、500 として扱う。
         */
        const fields = generationFailureFields(error)
        if (fields === null) throw error
        return c.json(fail(VALIDATION_ERROR_MESSAGE, fields), 422)
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

      const stretchedToFit = await fitTimingWhenStretched(deps, shot, compiled)
      const jobIds = await enqueueJobs(deps, shot, compiled, model, count, corrections, lineage.value)
      const generating = await deps.shots.updateStatus(shot.id, 'generating')
      await publishShotStatus(deps, generating)

      return c.json(
        ok({
          jobIds,
          specHash: compiled.specHash,
          resolvedModel: compiled.model.id,
          duplicateOfTakeId: duplicate === null ? null : duplicate.id,
          stretchedToFit,
        }),
        202,
      )
    })
