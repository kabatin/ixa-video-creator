import {
  HumanVerdict,
  ReviewFinding,
  ReviewRun,
  type ReviewRunId,
  type Take,
  TakeId,
} from '@ixa/domain'
import { z } from 'zod'
import { WireTake } from '@/lib/api-schemas'
import type { Requester } from '@/lib/requester'

/**
 * 自動レビューと人間の判断の呼び出し口（P4-6）。
 *
 * レビューは worker が非同期で走る。`requestReview` は受け付けられたことしか返さないので、
 * 結果は `listReviewRuns` / `getReviewRun` を引き直して確かめる。
 */

/** JSON には Date が無いため、ドメインのスキーマの日時列だけを coerce に差し替える。 */
export const WireReviewRun = ReviewRun.extend({ createdAt: z.coerce.date() })
export type WireReviewRun = z.infer<typeof WireReviewRun>

export const WireReviewRunList = z.array(WireReviewRun)

/** ReviewFinding に日時列は無いので、ドメインのスキーマをそのまま検証に使う。 */
export const WireReviewFinding = ReviewFinding
export type WireReviewFinding = z.infer<typeof WireReviewFinding>

/** `GET /review-runs/{id}`。run と findings を 1 往復で受け取る。 */
export const WireReviewDetail = z.object({
  run: WireReviewRun,
  findings: z.array(WireReviewFinding),
})
export type WireReviewDetail = z.infer<typeof WireReviewDetail>

/** `POST /takes/{takeId}/review` は 202。完了ではなく受理だけを表す。 */
export const WireReviewAccepted = z.object({
  takeId: TakeId,
  queued: z.boolean(),
})
export type WireReviewAccepted = z.infer<typeof WireReviewAccepted>

/**
 * 人間が下せる判断。`unreviewed` は「まだ判断していない」初期値であり、
 * 画面から明示的に戻す操作は用意しないためドメインの enum から除く。
 */
export const HumanDecision = HumanVerdict.exclude(['unreviewed'])
export type HumanDecision = z.infer<typeof HumanDecision>

export const VerdictBody = z.object({ verdict: HumanDecision })
export type VerdictBody = z.infer<typeof VerdictBody>

export type ReviewApi = {
  /** レビューをキューへ積む。完了は待たない。 */
  requestReview: (takeId: TakeId) => Promise<WireReviewAccepted>
  listReviewRuns: (takeId: TakeId) => Promise<WireReviewRun[]>
  getReviewRun: (id: ReviewRunId) => Promise<WireReviewDetail>
  setTakeVerdict: (takeId: TakeId, verdict: HumanDecision) => Promise<Take>
}

const takePath = (id: TakeId, suffix = ''): string => `/takes/${encodeURIComponent(id)}${suffix}`

export const createReviewApi = (requester: Requester): ReviewApi => ({
  requestReview: async (takeId) =>
    requester.post(takePath(takeId, '/review'), undefined, WireReviewAccepted),

  listReviewRuns: async (takeId) =>
    requester.get(takePath(takeId, '/reviews'), WireReviewRunList),

  getReviewRun: async (id) =>
    requester.get(`/review-runs/${encodeURIComponent(id)}`, WireReviewDetail),

  setTakeVerdict: async (takeId, verdict) =>
    requester.post(takePath(takeId, '/verdict'), VerdictBody.parse({ verdict }), WireTake),
})
