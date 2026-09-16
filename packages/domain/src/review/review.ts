import { z } from 'zod'
import { MediaAssetId, ProjectId, ReviewFindingId, ReviewRunId, TakeId } from '../common/ids.js'
import { Seconds } from '../common/time.js'

export const ReviewerType = z.enum([
  'technical',        // 尺・解像度・fps・黒フレーム（決定的）
  'music',            // ビート／ドロップ整合（決定的）
  'brand',            // ロゴ・色（ほぼ決定的）
  'identity',         // 人物一致（vision LLM）
  'continuity',       // 前後 Shot との整合（vision LLM）
  'composition',      // 構図（vision LLM）
  'prompt_adherence', // 記述との一致（vision LLM）
])
export type ReviewerType = z.infer<typeof ReviewerType>

/** 決定的に測れるレビュア。これが fail したら LLM 層を実行しない（ADR-0005）。 */
export const DETERMINISTIC_REVIEWERS: readonly ReviewerType[] = Object.freeze([
  'technical', 'music', 'brand',
])

export const LLM_REVIEWERS: readonly ReviewerType[] = Object.freeze([
  'identity', 'continuity', 'composition', 'prompt_adherence',
])

export const isDeterministicReviewer = (r: ReviewerType): boolean =>
  DETERMINISTIC_REVIEWERS.includes(r)

export const Verdict = z.enum(['pass', 'warn', 'fail'])
export type Verdict = z.infer<typeof Verdict>

export const Severity = z.enum(['info', 'warn', 'fail'])
export type Severity = z.infer<typeof Severity>

export const ReviewRun = z.object({
  id: ReviewRunId,
  takeId: TakeId,
  reviewers: z.array(ReviewerType),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  verdict: Verdict.nullable(),
  costUsd: z.number().nonnegative().default(0),
  createdAt: z.date(),
})
export type ReviewRun = z.infer<typeof ReviewRun>

export const ReviewFinding = z.object({
  id: ReviewFindingId,
  reviewRunId: ReviewRunId,
  reviewer: ReviewerType,
  severity: Severity,
  score: z.number().min(0).max(1).nullable(),
  message: z.string(),
  evidence: z.object({
    frameSec: Seconds.nullable(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    comparedAssetId: MediaAssetId.nullable(),
  }).nullable(),
  /** 再生成ループが機械的に使える形にする。自由文を返させない。 */
  suggestedPromptDelta: z.string().nullable(),
})
export type ReviewFinding = z.infer<typeof ReviewFinding>

/**
 * ReviewRun を 1 件作るときの入力。id と createdAt はリポジトリが採番する。
 * status は queued 固定にせず呼び出し側が決める（同期実行なら running から始まる）。
 */
export const CreateReviewRunInput = ReviewRun.omit({ id: true, createdAt: true })
export type CreateReviewRunInput = z.input<typeof CreateReviewRunInput>

/**
 * ReviewFinding を作るときの入力。id はリポジトリが採番する。
 * **指摘は追記のみ。** 既存の指摘を書き換える入力型は用意しない
 * （判定をやり直すなら新しい ReviewRun を作る）。
 */
export const CreateReviewFindingInput = ReviewFinding.omit({ id: true, reviewRunId: true })
export type CreateReviewFindingInput = z.input<typeof CreateReviewFindingInput>

/** ReviewRun の実行後に確定する列。status / verdict / costUsd のみ動く。 */
export const ReviewRunOutcome = z.object({
  status: ReviewRun.shape.status,
  verdict: Verdict.nullable(),
  costUsd: z.number().nonnegative(),
})
export type ReviewRunOutcome = z.infer<typeof ReviewRunOutcome>

export const aggregateVerdict = (
  findings: readonly Pick<ReviewFinding, 'severity'>[],
): Verdict => {
  if (findings.some((f) => f.severity === 'fail')) return 'fail'
  if (findings.some((f) => f.severity === 'warn')) return 'warn'
  return 'pass'
}

export const RegenerationPolicy = z.object({
  projectId: ProjectId,
  maxAttemptsPerShot: z.number().int().positive().default(3),
  maxCostPerShotUsd: z.number().positive().default(2),
  maxCostPerProjectUsd: z.number().positive(),
  requireHumanApprovalAfter: z.number().int().positive().default(2),
  autoRegenerateOn: z.array(ReviewerType).default(['identity', 'technical']),
})
export type RegenerationPolicy = z.infer<typeof RegenerationPolicy>

/**
 * Project から再生成ポリシーを導く。
 *
 * **ポリシー専用のテーブルは作らない。** 調整したい人がまだ居ないのに
 * CRUD 画面とマイグレーションが増えるだけで、既定値が 2 箇所（スキーマと DB 行）に散る。
 * 予算だけは Project が持っているので、それを上限に使う。
 *
 * `budgetUsd` が未設定の Project では上限が無いことになってしまうため、
 * ここで既定の上限を当てる。**「上限なし」を作らない**のがこの関数の役目。
 */
export const DEFAULT_PROJECT_BUDGET_USD = 200

export const resolveRegenerationPolicy = (project: {
  id: ProjectId
  budgetUsd: number | null
}): RegenerationPolicy =>
  RegenerationPolicy.parse({
    projectId: project.id,
    maxCostPerProjectUsd:
      project.budgetUsd === null || project.budgetUsd <= 0
        ? DEFAULT_PROJECT_BUDGET_USD
        : project.budgetUsd,
  })

export type RegenerationState = {
  attempts: number
  shotCostUsd: number
  projectCostUsd: number
}

export type RegenerationGate =
  | { allowed: true }
  | { allowed: false; reason: string; needsHuman: boolean }

/**
 * 再生成を続けてよいかの判定。無限ループを構造的に作れないようにする。
 * Worker ではなく純粋関数に置き、上限到達を必ずテストする（ARCHITECTURE.md §13）。
 */
export const canRegenerate = (
  policy: RegenerationPolicy,
  state: RegenerationState,
): RegenerationGate => {
  if (state.attempts >= policy.maxAttemptsPerShot) {
    return { allowed: false, reason: `再生成の上限 ${policy.maxAttemptsPerShot} 回に到達`, needsHuman: true }
  }
  if (state.shotCostUsd >= policy.maxCostPerShotUsd) {
    return { allowed: false, reason: `Shot あたりのコスト上限 $${policy.maxCostPerShotUsd} に到達`, needsHuman: true }
  }
  if (state.projectCostUsd >= policy.maxCostPerProjectUsd) {
    return { allowed: false, reason: `プロジェクトの予算 $${policy.maxCostPerProjectUsd} に到達`, needsHuman: true }
  }
  if (state.attempts >= policy.requireHumanApprovalAfter) {
    return { allowed: false, reason: `${policy.requireHumanApprovalAfter} 回失敗したため人間の判断が必要`, needsHuman: true }
  }
  return { allowed: true }
}
