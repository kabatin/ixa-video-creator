import { z } from '@hono/zod-openapi'
import type { ImageGenerationJob } from '@ixa/domain'

/**
 * 絵を作るときに実際に AI へ送った文（プロンプトビューア。制作者 2026-10-25）。
 * 開始フレームの履歴・キーアート・キャラクターシートが同じ形で返す。
 * 送った文を記録する前に作った絵は `sentPrompt` が null（画面は「記録していません」と出す）。
 */
export const ImagePromptFields = {
  /** 送った指示の本文（やり直しの直し方を足した後。Codex は包む前）。記録が無ければ null。 */
  sentPrompt: z.string().nullable(),
  /** 使った AI（モデル）。 */
  modelId: z.string(),
}

export const imagePromptFieldsOf = (
  job: Pick<ImageGenerationJob, 'sentPrompt' | 'modelId'>,
): { readonly sentPrompt: string | null; readonly modelId: string } => ({
  sentPrompt: job.sentPrompt,
  modelId: job.modelId,
})
