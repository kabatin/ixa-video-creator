import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, ShotRepository, TakeRepository } from '@ixa/db'
import {
  CreateProjectInput as CreateProjectInputSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  UpdateProjectPatch as UpdateProjectPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  buildCostMeter,
  type CostMeter,
  type Project,
  type ProjectId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Project の CRUD。ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 * 返すのは Domain 型を JSON へ写した DTO のみ。drizzle の row 型は API に出さない。
 */

/**
 * API が返す Project。Domain の `Project` と同じ形だが、
 * 日時は JSON で表現できる ISO8601 文字列にする。
 */
export const ProjectResponse = ProjectSchema.omit({ createdAt: true, updatedAt: true })
  .extend({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Project')
export type ProjectResponse = z.infer<typeof ProjectResponse>

/** Domain の Project を API の DTO へ写す（新しいオブジェクトを返す）。 */
export const toProjectResponse = (project: Project): ProjectResponse => ({
  ...project,
  createdAt: project.createdAt.toISOString(),
  updatedAt: project.updatedAt.toISOString(),
})

const CreateProjectBody = CreateProjectInputSchema.openapi('CreateProjectInput')
const UpdateProjectBody = UpdateProjectPatchSchema.openapi('UpdateProjectPatch')

const ProjectParams = z.object({
  id: ProjectIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

const ListProjectsQuery = z.object({
  workspaceId: WorkspaceIdSchema.openapi({ param: { name: 'workspaceId', in: 'query' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const createProjectRoute = createRoute({
  method: 'post',
  path: '/projects',
  tags: ['projects'],
  summary: 'プロジェクトを作成する',
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateProjectBody } } },
  },
  responses: {
    201: jsonContent('作成されたプロジェクト', successResponse(ProjectResponse)),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const listProjectsRoute = createRoute({
  method: 'get',
  path: '/projects',
  tags: ['projects'],
  summary: 'ワークスペース内のプロジェクト一覧',
  request: { query: ListProjectsQuery },
  responses: {
    200: jsonContent('プロジェクト一覧', listResponse(ProjectResponse)),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const getProjectRoute = createRoute({
  method: 'get',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: 'プロジェクトを 1 件取得する',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('プロジェクト', successResponse(ProjectResponse)),
    404: errorContent('プロジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const updateProjectRoute = createRoute({
  method: 'patch',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: 'プロジェクトを部分更新する',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: UpdateProjectBody } } },
  },
  responses: {
    200: jsonContent('更新後のプロジェクト', successResponse(ProjectResponse)),
    404: errorContent('プロジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const deleteProjectRoute = createRoute({
  method: 'delete',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: 'プロジェクトをソフトデリートする',
  request: { params: ProjectParams },
  responses: {
    204: { description: '削除した（本文なし）' },
    404: errorContent('プロジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

/**
 * 費用メーターの wire 形（PHASE 6.3）。
 *
 * Domain の `CostMeter` は `byShot` を `ReadonlyMap` で持つが、JSON に Map は無い。
 * ここで配列へ写す。**額だけでなく件数も必ず返す。**
 * スタブで回した Take は額が 0 なので、件数が無いと「何も起きていない」と区別が付かない。
 */
export const CostBucketResponse = z
  .object({
    takeCount: z.number().int().nonnegative(),
    totalUsd: z.number().nonnegative(),
  })
  .openapi('CostBucket')

/** 実測として数えた Provider 1 つ分。**名前を返す**ので、載せ忘れに画面から気付ける。 */
export const ProviderCostResponse = z
  .object({
    providerId: z.string().min(1),
    takeCount: z.number().int().nonnegative(),
    totalUsd: z.number().nonnegative(),
  })
  .openapi('ProviderCost')

export const MeasuredBucketResponse = CostBucketResponse.extend({
  byProvider: z.array(ProviderCostResponse),
}).openapi('MeasuredBucket')

/** `byShot` に行として出せなかった分（論理削除された Shot）。合計には入っている。 */
export const UnlistedShotCostResponse = z
  .object({
    takeCount: z.number().int().nonnegative(),
    measuredUsd: z.number().nonnegative(),
    /** **件数**。額ではない（`ShotCost.stubTakeCount` と単位を揃える）。 */
    stubTakeCount: z.number().int().nonnegative(),
  })
  .openapi('UnlistedShotCost')

/** **額と件数は名前で区別する。** スタブの額は常に 0 なので、件数で持つ方が情報がある。 */
export const ShotCostResponse = z
  .object({
    shotId: ShotIdSchema,
    measuredUsd: z.number().nonnegative(),
    stubTakeCount: z.number().int().nonnegative(),
  })
  .openapi('ShotCost')

export const OtherRunCostResponse = z
  .object({
    /** `storyboard_draft` / `review` など。表示の言葉は画面が持つ。 */
    kind: z.string().min(1),
    runCount: z.number().int().positive(),
    totalUsd: z.number().nonnegative(),
  })
  .openapi('OtherRunCost')
export type OtherRunCostResponse = z.infer<typeof OtherRunCostResponse>

export const CostMeterResponse = z
  .object({
    /** null は「予算未設定」。0（予算ゼロ）とは別の状態。 */
    budgetUsd: z.number().nonnegative().nullable(),
    measured: MeasuredBucketResponse,
    stub: CostBucketResponse,
    /** **生きている Shot だけ**の内訳。合計と一致しないことがある。 */
    byShot: z.array(ShotCostResponse),
    /** 内訳と合計の差の説明。黙って捨てない。 */
    unlistedShots: UnlistedShotCostResponse,
    /** Take 以外で払った額（絵コンテ下書き・レビュー）。0 件の種類は並べない。 */
    otherRuns: z.array(OtherRunCostResponse),
    /** **予算と突き合わせるのはこの額。** 実測の Take と otherRuns の合計。 */
    totalUsd: z.number().nonnegative(),
  })
  .openapi('CostMeter')
export type CostMeterResponse = z.infer<typeof CostMeterResponse>

/** Domain の CostMeter を DTO へ写す（Map → 配列）。 */
export const toCostMeterResponse = (meter: CostMeter): CostMeterResponse => ({
  budgetUsd: meter.budgetUsd,
  otherRuns: meter.otherRuns.map((run) => ({ ...run })),
  totalUsd: meter.totalUsd,
  measured: { ...meter.measured, byProvider: meter.measured.byProvider.map((p) => ({ ...p })) },
  stub: { ...meter.stub },
  byShot: [...meter.byShot].map(([shotId, cost]) => ({ shotId, ...cost })),
  unlistedShots: { ...meter.unlistedShots },
})

const getProjectCostRoute = createRoute({
  method: 'get',
  path: '/projects/{id}/cost',
  tags: ['projects'],
  summary: '使った額を出どころ（実測 / スタブ）で割って返す',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('費用メーター', successResponse(CostMeterResponse)),
    404: errorContent('プロジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type ProjectRoutesDeps = {
  projects: ProjectRepository
  /** 行として出せる Shot を知るために引く。**額の合計には使わない。** */
  shots: ShotRepository
  takes: TakeRepository
  /**
   * 下書きの実行費を数えるために引く。**生成だけが金を使うわけではない。**
   *
   * **実際に読む欄だけを構造的な型で受ける**（`build-generation.ts` と同じ方針）。
   * リポジトリ全体を要求すると、テストの偽物が関係の無い口まで埋めることになる。
   */
  storyboardDrafts: {
    findRunsByProject(projectId: ProjectId): Promise<readonly { readonly costUsd: number }[]>
  }
  /** レビューの実行費を数えるために引く。 */
  reviews: {
    sumCostByProject(
      projectId: ProjectId,
    ): Promise<{ readonly runCount: number; readonly totalUsd: number }>
  }
  /**
   * スタブ Provider の ID。**app 層が渡す。**
   *
   * `ProviderRegistry` に素性の印が無いため、`@ixa/provider-video` の `STUB_PROVIDER_ID` を
   * main / app が注入する。**今 registry にいる Provider と突き合わせてはいけない。**
   * 突き合わせると、registry からスタブを外した瞬間に過去の Take が「実測」に化ける。
   */
  stubProviderIds: readonly string[]
}

export const projectRoutes = ({
  projects,
  shots,
  takes,
  storyboardDrafts,
  reviews,
  stubProviderIds,
}: ProjectRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(createProjectRoute, async (c) => {
      const created = await projects.create(c.req.valid('json'))
      return c.json(ok(toProjectResponse(created)), 201)
    })
    .openapi(listProjectsRoute, async (c) => {
      const { workspaceId } = c.req.valid('query')
      const found = await projects.findByWorkspace(workspaceId)
      return c.json(okList(found.map(toProjectResponse)), 200)
    })
    .openapi(getProjectRoute, async (c) => {
      const found = await projects.findById(c.req.valid('param').id)
      if (found === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      return c.json(ok(toProjectResponse(found)), 200)
    })
    .openapi(updateProjectRoute, async (c) => {
      const updated = await projects.update(c.req.valid('param').id, c.req.valid('json'))
      return c.json(ok(toProjectResponse(updated)), 200)
    })
    .openapi(deleteProjectRoute, async (c) => {
      await projects.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
    .openapi(getProjectCostRoute, async (c) => {
      const projectId = c.req.valid('param').id
      const project = await projects.findById(projectId)
      if (project === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }

      // **合計は論理削除済み Shot の Take も含めて数える**（`findByProject` の約束）。
      // 払った額は Shot を消しても戻らない。生きている Shot だけで数えると予算が軽く見え、
      // 画面は「余裕あり」なのに `checkCostLimits` が弾く、という食い違いになる。
      //
      // 一方 Shot ごとの内訳は行として出せないので、生きている Shot だけに絞り、
      // 溢れた分は `unlistedShots` に残す（捨てない）。
      const [projectTakes, liveShots, draftRuns, reviewCost] = await Promise.all([
        takes.findByProject(projectId),
        shots.findByProject(projectId),
        // **生成だけが金を使うわけではない。** 下書きとレビューの実行費も数える。
        // 数えないと予算が実際より軽く見える（実際に下書き 1 回で $0.38 払った）。
        storyboardDrafts.findRunsByProject(projectId),
        reviews.sumCostByProject(projectId),
      ])

      const meter = buildCostMeter({
        budgetUsd: project.budgetUsd,
        takes: projectTakes.map((take) => ({
          shotId: take.shotId,
          costUsd: take.costUsd,
          providerId: take.providerId,
        })),
        stubProviderIds,
        listedShotIds: liveShots.map((shot) => shot.id),
        otherRuns: [
          {
            kind: 'storyboard_draft',
            runCount: draftRuns.length,
            totalUsd: draftRuns.reduce((total, run) => total + run.costUsd, 0),
          },
          { kind: 'review', runCount: reviewCost.runCount, totalUsd: reviewCost.totalUsd },
        ],
      })

      return c.json(ok(toCostMeterResponse(meter)), 200)
    })
