import { z } from 'zod'

/**
 * fal Queue API の応答（CLAUDE.md 規約 4「Provider レスポンスも zod で検証する」）。
 *
 * **未知のキーは落とす（zod の既定）が、形が違えば必ず失敗させる。**
 * 握り潰して pending へ丸めると、終わらないジョブが延々とポーリングされ続ける。
 */

/** 失敗は `error`（人向け）と `error_type`（機械向け）で返りうる。どの状態にも付きうる。 */
const failureFields = {
  error: z.string().nullish(),
  error_type: z.string().nullish(),
}

export const FalSubmitResponse = z.object({
  request_id: z.string().min(1),
  queue_position: z.number().int().nonnegative().nullish(),
})
export type FalSubmitResponse = z.infer<typeof FalSubmitResponse>

export const FalStatusResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('IN_QUEUE'),
    queue_position: z.number().int().nonnegative().nullish(),
    ...failureFields,
  }),
  z.object({
    status: z.literal('IN_PROGRESS'),
    logs: z.array(z.unknown()).nullish(),
    ...failureFields,
  }),
  z.object({
    status: z.literal('COMPLETED'),
    metrics: z.object({ inference_time: z.number().nullish() }).nullish(),
    ...failureFields,
  }),
])
export type FalStatusResponse = z.infer<typeof FalStatusResponse>

/** `bytedance/seedance-2.5/reference-to-video` の出力（形は 2.0 と同じ）。 */
export const FalSeedanceOutput = z.object({
  video: z.object({
    /** **期限付き URL。DB にも例外にもログにも出さない**（CLAUDE.md 規約 7）。 */
    url: z.string().url(),
    content_type: z.string().nullish(),
    file_name: z.string().nullish(),
    file_size: z.number().int().nonnegative().nullish(),
  }),
  seed: z.number().int().nullish(),
})
export type FalSeedanceOutput = z.infer<typeof FalSeedanceOutput>

/** 結果の口が出力ではなく失敗を返してきた場合の形。 */
export const FalFailurePayload = z.object(failureFields)
export type FalFailurePayload = z.infer<typeof FalFailurePayload>
