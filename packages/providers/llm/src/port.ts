import { z } from 'zod'
import { Severity } from '@ixa/domain'
import type { ReviewerType, Seconds } from '@ixa/domain'

/**
 * vision LLM レビュアの契約（ADR-0005 Stage 2 / ADR-0012）。
 *
 * **LLM に自由文を返させない。** 応答は必ずこのスキーマで検証し、
 * 通らなければ例外にする。再生成ループが機械的に読むため、
 * 形の崩れた応答を「とりあえず通す」ことをしない。
 */

/** 判定に渡す画像 1 枚。実体は呼び出し側が用意し、ここでは参照だけを持つ。 */
export const ReviewImage = z.object({
  /** 何を写した画像かを LLM に伝えるラベル。'frame@1.5s' / 'reference:face_front' など。 */
  label: z.string().min(1),
  /** 都度発行した署名付き URL。**保存しない**（CLAUDE.md 規約 7）。 */
  url: z.string().min(1),
})
export type ReviewImage = z.infer<typeof ReviewImage>

/** LLM に渡す判定依頼。 */
export const VisionReviewRequest = z.object({
  reviewer: z.custom<ReviewerType>(),
  /** 判定対象のフレーム。最低 1 枚。 */
  subjects: z.array(ReviewImage).min(1),
  /** 比較対象（参照画像・前 Shot の最終フレームなど）。無い場合は空。 */
  references: z.array(ReviewImage),
  /** 判定基準。Shot の description や camera 指示を文にしたもの。 */
  criteria: z.string().min(1),
})
export type VisionReviewRequest = z.infer<typeof VisionReviewRequest>

/**
 * LLM の応答。**structured output を強制する形**。
 * `score` は 0..1 で、1 が「完全に一致」。
 */
export const VisionReviewResult = z.object({
  severity: Severity,
  score: z.number().min(0).max(1),
  /** 人が読む指摘。1 文。 */
  message: z.string().min(1),
  /** 指摘箇所の秒数。分からなければ null。 */
  frameSec: z.number().nullable(),
  /**
   * 再生成ループが機械的に使うプロンプト差分。
   * 直すべき点が無ければ null。**「頑張って」のような指示を返させない。**
   */
  suggestedPromptDelta: z.string().nullable(),
})
export type VisionReviewResult = z.infer<typeof VisionReviewResult>

export type VisionReviewOutcome = {
  readonly result: VisionReviewResult
  /** 実際に支払ったコスト。測れないなら 0 を返す（推測値を入れない）。 */
  readonly costUsd: number
}

/**
 * vision LLM レビュアのアダプタ。
 * 実装は `@ixa/provider-llm` 内に閉じ、外部 SDK / CLI をここから漏らさない。
 */
export type VisionReviewer = {
  readonly name: string
  /** このアダプタが判定できるレビュア種別。 */
  readonly supports: readonly ReviewerType[]
  review(request: VisionReviewRequest): Promise<VisionReviewOutcome>
}

/** 秒数の再輸出。呼び出し側が frameSec を Seconds として扱えるようにする。 */
export type { Seconds }
