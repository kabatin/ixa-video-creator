import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  GenerationJobRepository,
  ProjectRepository,
  ShotRepository,
  TakeRepository,
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

const SelectTakeBody = z.object({ takeId: TakeIdSchema }).openapi('SelectTakeInput')

/**
 * 生成ジョブの状態。UI が「生成が終わったか」を判定するために必要。
 * Take の本数で推測すると、失敗したジョブを待ち続けることになる。
 */
export const GenerationJobResponse = GenerationJobSchema.omit({
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
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
/**
 * 後から直せる列。
 *
 * `code` と `mood` も直せる。ストーリーボードの一括作成は `VERSE-01` のような
 * 機械的なコードと空の `mood` を付けるので、**後から直せないと直す手段が無い**。
 * `selectedTakeId` と `status` は専用の口があるので含めない（不変条件を伴う更新を
 * 汎用の patch で素通りさせないため）。
 */
const UpdateShotBody = UpdateShotPatchSchema.pick({
  code: true,
  description: true,
  mood: true,
  continuityMode: true,
  camera: true,
  sourceType: true,
  startSec: true,
  durationSec: true,
  sourceInSec: true,
  // Take を尺に合わせて速度を変えるか（ADR-0026）。
  timing: true,
  // 場所は後から決められる。null を送れば外す（ADR-0015）。
  locationId: true,
}).openapi('UpdateShotPatch')

/**
 * PostgreSQL の一意制約違反かどうか。
 * **エラーの型で判定せず code で見る。** drizzle は driver の例外を包んで投げるため、
 * instanceof では捕まえられない（実際に包まれていることを確認済み）。
 */
const isUniqueViolation = (error: unknown): boolean => {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

/** `(project_id, code)` は UNIQUE。衝突は利用者の入力ミスなので 422 で返す。 */
export const DUPLICATE_SHOT_CODE_MESSAGE = 'このコードは同じ Project の別の Shot が使っています'

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

const createShotRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/shots',
  tags: ['shots'],
  summary: 'Shot を作成する',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: CreateShotBody } } },
  },
  responses: {
    201: jsonContent('作成された Shot', successResponse(ShotResponse)),
    ...commonErrors,
  },
})

const updateShotRoute = createRoute({
  method: 'patch',
  path: '/shots/{id}',
  tags: ['shots'],
  summary: 'Shot を部分更新する',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: UpdateShotBody } } },
  },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

const deleteShotRoute = createRoute({
  method: 'delete',
  path: '/shots/{id}',
  tags: ['shots'],
  summary: 'Shot をソフトデリートする',
  request: { params: ShotParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
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

const selectTakeRoute = createRoute({
  method: 'post',
  path: '/shots/{id}/select-take',
  tags: ['shots'],
  summary: '採用 Take を決める',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: SelectTakeBody } } },
  },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

const unselectTakeRoute = createRoute({
  method: 'delete',
  path: '/shots/{id}/selected-take',
  tags: ['shots'],
  summary: '採用 Take を外す（Take そのものは消さない）',
  request: { params: ShotParams },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

export type ShotRoutesDeps = {
  shots: ShotRepository
  projects: ProjectRepository
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
  if (!stretchesToFit(shot.durationSec, compiled.spec.durationSec)) return false
  if (shot.timing !== 'fit') await deps.shots.update(shot.id, { timing: 'fit' })
  return true
}

/** GenerationJob 行を作りつつキューへ入れる。DB が真実、キューは実行手段（ADR-0008）。 */
export const enqueueJobs = async (
  deps: Pick<ShotRoutesDeps, 'generationJobs' | 'queue'>,
  shot: Shot,
  compiled: CompiledGeneration<VideoModelDescriptor>,
  requestedModel: ModelId | 'AUTO',
  count: number,
  corrections: readonly string[] = [],
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
  await deps.shots.selectTake(shotId, take.id)
  // 判断は domain の 1 箇所（worker の成功・失敗と同じ関数を引く）。
  const updated = await deps.shots.updateStatus(
    shotId,
    settledShotStatus({ hasSelectedTake: true, hasTakes: true }),
  )
  // 1 件ずつの採用も一括採用もここを通るので、出来事もここで 1 回だけ流す。
  await publishShotStatus(deps, updated)
  return updated
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
  await deps.shots.selectTake(shot.id, null)
  const updated =
    shot.status === 'generating'
      ? await deps.shots.findById(shot.id)
      : await deps.shots.updateStatus(
          shot.id,
          settledShotStatus({ hasSelectedTake: false, hasTakes: true }),
        )
  if (updated === null) throw new Error(`採用を外した Shot が見つかりません: ${shot.id}`)
  await publishShotStatus(deps, updated)
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
      const patch = c.req.valid('json')

      /**
       * コードの重複は `(project_id, code)` の UNIQUE が弾く。
       * **DB の例外をそのまま 500 にしない。** 利用者の入力ミスなので、
       * 何が悪いか分かる 422 にする。他の Shot を読み比べるより、
       * 制約に任せて衝突だけを畳むほうが競合に強い。
       */
      try {
        const updated = await deps.shots.update(c.req.valid('param').id, patch)
        return c.json(ok(toShotResponse(updated)), 200)
      } catch (error) {
        if (patch.code !== undefined && isUniqueViolation(error)) {
          return c.json(
            fail(VALIDATION_ERROR_MESSAGE, { code: [DUPLICATE_SHOT_CODE_MESSAGE] }),
            422,
          )
        }
        throw error
      }
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

      const updated = await applySelectedTake(deps, shot.id, take)
      return c.json(ok(toShotResponse(updated)), 200)
    })
    .openapi(unselectTakeRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toShotResponse(await clearSelectedTake(deps, shot))), 200)
    })
    .openapi(generateRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const project = await deps.projects.findById(shot.projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { model, count, corrections } = c.req.valid('json')

      let compiled: CompiledGeneration<VideoModelDescriptor>
      try {
        compiled = await buildGeneration(await generationPorts(deps), shot, project, model, {
          corrections,
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
      const jobIds = await enqueueJobs(deps, shot, compiled, model, count, corrections)
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
