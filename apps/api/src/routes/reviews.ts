import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ReviewRepository, TakeRepository } from '@ixa/db'
import {
  HumanVerdict as HumanVerdictSchema,
  ReviewFinding as ReviewFindingSchema,
  ReviewRun as ReviewRunSchema,
  ReviewRunId as ReviewRunIdSchema,
  TakeId as TakeIdSchema,
  type ReviewRun,
  type TakeId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'
import { TakeResponse, toTakeResponse } from './shots.js'

/**
 * Take のレビュー実行と、その結果の参照（docs/ARCHITECTURE.md §12 / ADR-0005）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * 判定そのものは worker が行う。ここは**キューに積むところまで**で、
 * 結果を待たない（Stage 2 の vision LLM は 1 Take で数十秒かかるため HTTP を占有しない）。
 */

/** BullMQ のキュー名（docs/ARCHITECTURE.md §20）。apps 同士を import しないため定数で持つ。 */
export const REVIEW_QUEUE_NAME = 'review'

/**
 * レビューをキューへ投入する Port。Redis への依存を main.ts に閉じ込める。
 *
 * ジョブデータは TakeId のみ（ADR-0008）。**ReviewRun は API では作らない。**
 * ADR-0005 の Stage 1 が fail すると Stage 2 は実行されないため、
 * 実際に走ったレビュアの一覧は worker にしか分からない。
 * ここで全レビュアを並べて作ると `ReviewRun.reviewers` が実態と食い違う。
 */
export type ReviewQueue = {
  enqueue(takeId: TakeId): Promise<void>
}

/**
 * API が返す ReviewRun。日時は ISO8601 文字列にする。
 * `verdict` は実行が終わるまで null（docs/DOMAIN.md §11）。
 */
export const ReviewRunResponse = ReviewRunSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('ReviewRun')
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>

export const toReviewRunResponse = (run: ReviewRun): ReviewRunResponse => ({
  ...run,
  createdAt: run.createdAt.toISOString(),
})

/** ReviewFinding は日時を持たないのでドメイン型をそのまま返せる。 */
export const ReviewFindingResponse = ReviewFindingSchema.openapi('ReviewFinding')
export type ReviewFindingResponse = z.infer<typeof ReviewFindingResponse>

/**
 * 1 回分の実行と、その指摘。
 * 一覧（`GET /takes/{takeId}/reviews`）には指摘を含めない。
 * **1 Take で数十件になり得る**ため、必要になった実行だけを引く。
 */
const ReviewRunDetail = z
  .object({ run: ReviewRunResponse, findings: z.array(ReviewFindingResponse) })
  .openapi('ReviewRunDetail')

const ReviewAccepted = z
  .object({
    takeId: TakeIdSchema,
    /** 冪等。レビュー済みでもキューには積む（skip 判定は worker が持つ）。 */
    queued: z.boolean(),
  })
  .openapi('ReviewAccepted')

/** 人間が下せる最終判断。`unreviewed` へは戻せない（判断の取り消しは記録として残らない）。 */
const HumanDecision = HumanVerdictSchema.extract(['approved', 'rejected'])

const VerdictBody = z.object({ verdict: HumanDecision }).openapi('TakeVerdictInput')

const TakeParams = z.object({
  takeId: TakeIdSchema.openapi({ param: { name: 'takeId', in: 'path' } }),
})
const ReviewRunParams = z.object({
  id: ReviewRunIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
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

const requestReviewRoute = createRoute({
  method: 'post',
  path: '/takes/{takeId}/review',
  tags: ['reviews'],
  summary: 'レビューを review キューへ投入する（結果は待たない）',
  request: { params: TakeParams },
  responses: {
    202: jsonContent('レビューを受け付けた', successResponse(ReviewAccepted)),
    ...commonErrors,
  },
})

const listReviewsRoute = createRoute({
  method: 'get',
  path: '/takes/{takeId}/reviews',
  tags: ['reviews'],
  summary: 'Take のレビュー履歴（新しい順）',
  request: { params: TakeParams },
  responses: {
    200: jsonContent('ReviewRun 一覧', listResponse(ReviewRunResponse)),
    ...commonErrors,
  },
})

const getReviewRunRoute = createRoute({
  method: 'get',
  path: '/review-runs/{id}',
  tags: ['reviews'],
  summary: '1 回分の実行と、その指摘の一覧',
  request: { params: ReviewRunParams },
  responses: {
    200: jsonContent('ReviewRun と ReviewFinding', successResponse(ReviewRunDetail)),
    ...commonErrors,
  },
})

const putVerdictRoute = createRoute({
  method: 'post',
  path: '/takes/{takeId}/verdict',
  tags: ['reviews'],
  summary: '人間の最終判断を記録する',
  request: {
    params: TakeParams,
    body: { required: true, content: { 'application/json': { schema: VerdictBody } } },
  },
  responses: {
    200: jsonContent('更新された Take', successResponse(TakeResponse)),
    ...commonErrors,
  },
})

/**
 * レビュー結果の書き込みは worker が行うため、API は**読む口しか持たない**。
 * `Pick` で絞ることで、ここから ReviewRun を作れないことを型で示す。
 */
export type ReviewRoutesDeps = {
  takes: Pick<TakeRepository, 'findById' | 'updateReview'>
  reviews: Pick<ReviewRepository, 'findRunById' | 'findRunsByTake' | 'findFindingsByRun'>
  queue: ReviewQueue
}

export const reviewRoutes = (deps: ReviewRoutesDeps) => {
  const takeMissing = async (takeId: TakeId): Promise<boolean> =>
    (await deps.takes.findById(takeId)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(requestReviewRoute, async (c) => {
      const { takeId } = c.req.valid('param')
      if (await takeMissing(takeId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      /**
       * レビュー済みかどうかはここでは見ない。冪等判定は worker が持つ。
       * API 側にも同じ判定を置くと、**再レビューの可否が 2 箇所に散る**ため。
       */
      await deps.queue.enqueue(takeId)
      return c.json(ok({ takeId, queued: true }), 202)
    })
    .openapi(listReviewsRoute, async (c) => {
      const { takeId } = c.req.valid('param')
      if (await takeMissing(takeId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const runs = await deps.reviews.findRunsByTake(takeId)
      return c.json(okList(runs.map(toReviewRunResponse)), 200)
    })
    .openapi(getReviewRunRoute, async (c) => {
      const { id } = c.req.valid('param')

      const run = await deps.reviews.findRunById(id)
      if (run === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const findings = await deps.reviews.findFindingsByRun(id)
      return c.json(ok({ run: toReviewRunResponse(run), findings: [...findings] }), 200)
    })
    .openapi(putVerdictRoute, async (c) => {
      const { takeId } = c.req.valid('param')
      const { verdict } = c.req.valid('json')

      if (await takeMissing(takeId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      /**
       * 人間の判断は `humanVerdict` にだけ入れる。`reviewStatus` は触らない。
       * あれは**自動レビューが何を出したか**の記録で、人間が承認しても書き換えない
       * （ADR-0003 / 「fail だったが人間が通した」が後から分からなくなる）。
       */
      const updated = await deps.takes.updateReview(takeId, { humanVerdict: verdict })
      return c.json(ok(toTakeResponse(updated)), 200)
    })
}
