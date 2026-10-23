import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import type { CheckResult } from '../lib/wait-loop.js'
import { WireTake } from '../wire.js'
import { defineTool, Id, jsonResult } from '../tool-def.js'

/**
 * Take のレビュー（ADR-0057）。既定では生成の後に自動ではレビューしない（「NG なら自動で作り直す」を付けた生成だけ自動）。
 * 付けずに作った Take は、エージェントがここで頼んで確かめ、NG なら直しを添えて generate_takes で作り直す。
 */

const WireReviewAccepted = z.object({ takeId: z.string(), queued: z.boolean() })

const WireReviewRun = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  verdict: z.enum(['pass', 'warn', 'fail']).nullable(),
  costUsd: z.number(),
})

const WireReviewDetail = z.object({
  run: WireReviewRun,
  findings: z.array(
    z.object({
      reviewer: z.string(),
      severity: z.string(),
      message: z.string(),
      suggestedPromptDelta: z.string().nullable(),
    }),
  ),
})

export const reviewTakeTool = defineTool({
  name: 'review_take',
  risk: 'costly',
  description:
    'Run the automatic review of a take (duration/resolution/brand checks, then a vision check of identity, composition and ' +
    'prompt adherence). Generation does not review by default; use this to check a take yourself. Then wait ' +
    '{kind:"review", id: takeId}; the result has the verdict (pass/warn/fail), cost and findings with fixes. To retake, ' +
    'call generate_takes with corrections from the fixes, parentTakeId and regenerationReason. ' +
    'With verdict, only records the person\'s own OK (approved) / NG (rejected) on the take instead (no automatic review).',
  input: z.object({
    takeId: Id,
    verdict: z.enum(['approved', 'rejected']).optional().describe("The person's decision. Record only what they said."),
  }),
  handler: async ({ takeId, verdict }, { api }) => {
    if (verdict !== undefined) {
      const take = await api.post(`/takes/${seg(takeId)}/verdict`, { verdict }, WireTake)
      return jsonResult({ takeId: take.id, verdict: take.humanVerdict })
    }
    const accepted = await api.post(`/takes/${seg(takeId)}/review`, {}, WireReviewAccepted)
    return jsonResult({ takeId, queued: accepted.queued, next: { tool: 'wait', jobs: [{ kind: 'review', id: takeId }] } })
  },
})

/** wait の問い合わせ。いちばん新しいレビューが終わるまで待ち、判定・費用・指摘（直し方つき）を返す。 */
export const reviewCheck = async (api: ApiClient, takeId: string): Promise<CheckResult> => {
  const [latest] = await api.get(`/takes/${seg(takeId)}/reviews`, z.array(WireReviewRun))
  if (latest === undefined) return { state: 'failed', detail: { error: 'この Take はまだレビューを頼んでいません（review_take）' } }
  if (latest.status === 'queued' || latest.status === 'running') return { state: 'pending', detail: { status: latest.status } }
  if (latest.status === 'failed') return { state: 'failed', detail: { error: 'レビューを最後まで行えませんでした' } }
  const detail = await api.get(`/review-runs/${seg(latest.id)}`, WireReviewDetail)
  return {
    state: 'succeeded',
    detail: {
      verdict: latest.verdict,
      costUsd: latest.costUsd,
      findings: detail.findings.map((finding) => ({
        reviewer: finding.reviewer,
        severity: finding.severity,
        message: finding.message,
        fix: finding.suggestedPromptDelta,
      })),
    },
  }
}
