import { z } from '@hono/zod-openapi'
import type { ImageGenerationJob } from '@ixa/domain'
import { CODEX_CLI_PROVIDER_ID } from '@ixa/provider-image'

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
  /**
   * AI が送る前に決まった前置き（絵の作り・参照の役割）を足して送るか（Codex）。`sentPrompt` は前置きを足す前の文。
   */
  sentWithPreamble: z.boolean(),
}

export const imagePromptFieldsOf = (
  job: Pick<ImageGenerationJob, 'sentPrompt' | 'modelId' | 'providerId'>,
): { readonly sentPrompt: string | null; readonly modelId: string; readonly sentWithPreamble: boolean } => ({
  sentPrompt: job.sentPrompt,
  modelId: job.modelId,
  sentWithPreamble: job.providerId === CODEX_CLI_PROVIDER_ID,
})
