import { z } from '@hono/zod-openapi'
import {
  ImageCheckIssue as ImageCheckIssueSchema,
  ImageCheckOutcome as ImageCheckOutcomeSchema,
  imageCheckMark,
  type ImageCheck,
} from '@ixa/domain'

/**
 * 作った絵のチェックの結果（ADR-0055）を画面・MCP へ渡す形。開始フレームの履歴・識別画像・キーアートが共有する。
 * 費用と内部の ID は出さない（画面の言葉の規則）。
 */

/** 画面の印。`unchecked` は見ていない（飛ばした・落ちた）。 */
export const ImageCheckMarkSchema = z.enum(['pass', 'review', 'retry', 'unchecked'])

export const ImageCheckSummary = z
  .object({
    mark: ImageCheckMarkSchema,
    outcome: ImageCheckOutcomeSchema,
    /** 0〜1。見ていなければ null。 */
    score: z.number().nullable(),
    issues: z.array(ImageCheckIssueSchema),
    /** 飛ばした・落ちた理由。 */
    note: z.string().nullable(),
  })
  .openapi('ImageCheckSummary')
export type ImageCheckSummary = z.infer<typeof ImageCheckSummary>

export const toImageCheckSummary = (check: ImageCheck | null): ImageCheckSummary | null =>
  check === null
    ? null
    : {
        mark: imageCheckMark(check),
        outcome: check.outcome,
        score: check.score,
        issues: [...check.issues],
        note: check.note,
      }
