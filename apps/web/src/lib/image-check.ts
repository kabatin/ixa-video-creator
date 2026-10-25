import {
  ImageCheckIssue,
  ImageCheckOutcome,
  ImageGenerationJobId,
  ImageGenerationJobStatus,
  MediaAssetId,
  type CharacterId,
  type ShotId,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 作った絵のチェック（ADR-0055）の画面の形と言葉。開始フレームの履歴・識別画像・キーアートが共有する。
 *
 * ```
 * GET  /shots/{id}/start-frame/history        開始フレームとして作った絵（新しい順）
 * GET  /characters/{id}/identity-images/checks キャラクターシートとして作った識別画像のチェック
 * POST /image-jobs/{id}/retry                  やり直す（同じ AI で、つながりに足す）
 * ```
 */

export const WireImageCheckMark = z.enum(['pass', 'review', 'retry', 'unchecked'])
export type WireImageCheckMark = z.infer<typeof WireImageCheckMark>

export const WireImageCheck = z.object({
  mark: WireImageCheckMark,
  outcome: ImageCheckOutcome,
  score: z.number().nullable(),
  issues: z.array(ImageCheckIssue),
  note: z.string().nullable(),
})
export type WireImageCheck = z.infer<typeof WireImageCheck>

export const WireImageHistoryEntry = z.object({
  jobId: ImageGenerationJobId,
  status: ImageGenerationJobStatus,
  attempt: z.number().int(),
  retryOfJobId: ImageGenerationJobId.nullable(),
  mediaAssetId: MediaAssetId.nullable(),
  applied: z.boolean(),
  current: z.boolean(),
  check: WireImageCheck.nullable(),
  error: z.string().nullable(),
  queuedAt: z.coerce.date(),
  /** 実際に送った指示の本文（プロンプトビューア）。記録する前の絵は null。 */
  sentPrompt: z.string().nullable().optional(),
  /** 使った AI（モデル）。 */
  modelId: z.string().nullable().optional(),
  /** AI が送る前に決まった前置きを足すか（Codex）。`sentPrompt` は足す前の文。 */
  sentWithPreamble: z.boolean().optional(),
})
export type WireImageHistoryEntry = z.infer<typeof WireImageHistoryEntry>

export const WireStartFrameHistory = z.object({ items: z.array(WireImageHistoryEntry), maxRetries: z.number().int() })
export type WireStartFrameHistory = z.infer<typeof WireStartFrameHistory>

export const WireIdentityImageCheck = z.object({
  mediaAssetId: MediaAssetId,
  jobId: ImageGenerationJobId,
  check: WireImageCheck.nullable(),
})
export type WireIdentityImageCheck = z.infer<typeof WireIdentityImageCheck>

/** 印の言葉。○ は「問題なし」。 */
export const IMAGE_CHECK_MARK_LABELS: Readonly<Record<WireImageCheckMark, string>> = {
  pass: '○ 問題なし',
  review: '要確認',
  retry: 'やり直し',
  unchecked: '未チェック',
}

/** 理由の 1 行（ツールチップ・拡大の下に出す）。見ていなければ、見ていない理由。 */
export const imageCheckReason = (check: WireImageCheck | null): string | null => {
  if (check === null) return null
  if (check.issues.length > 0) return check.issues.map((issue) => issue.message).join(' / ')
  return check.note
}

/** 待っている・作っている・チェックしている。終わったもの（成功・失敗・止めた）は外す。 */
export const isImageJobActive = (status: ImageGenerationJobStatus | undefined): boolean =>
  status === 'queued' || status === 'running' || status === 'checking'

/**
 * 作っている間の 1 行（ADR-0055「チェック中」「やり直し 1/2」）。`attempt` は 1 から。`what` は何の絵か。
 * 動いていなければ null。上限が分からなければ回数だけ出す。
 */
export const imageJobProgressText = (
  job: { readonly status: ImageGenerationJobStatus; readonly attempt: number } | null,
  maxRetries: number | null,
  what: string,
): string | null => {
  if (job === null || !isImageJobActive(job.status)) return null
  const retry =
    job.attempt > 1 ? `やり直し ${String(job.attempt - 1)}${maxRetries === null ? '' : `/${String(maxRetries)}`}・` : ''
  return job.status === 'checking' ? `${retry}${what}をチェックしています` : `${retry}${what}を作っています`
}

export type ImageCheckApi = {
  readonly getStartFrameHistory: (shotId: ShotId) => Promise<WireStartFrameHistory>
  readonly listIdentityImageChecks: (characterId: CharacterId) => Promise<WireIdentityImageCheck[]>
  /** やり直す。作り始めたジョブを返す（作っている最中は断られる）。 */
  readonly retryImage: (jobId: ImageGenerationJobId) => Promise<{ readonly jobId: ImageGenerationJobId }>
}

export const createImageCheckApi = (requester: Requester): ImageCheckApi => ({
  getStartFrameHistory: async (shotId) =>
    requester.get(`/shots/${encodeURIComponent(shotId)}/start-frame/history`, WireStartFrameHistory),
  listIdentityImageChecks: async (characterId) =>
    requester.get(`/characters/${encodeURIComponent(characterId)}/identity-images/checks`, z.array(WireIdentityImageCheck)),
  retryImage: async (jobId) =>
    requester.post(`/image-jobs/${encodeURIComponent(jobId)}/retry`, {}, z.object({ jobId: ImageGenerationJobId })),
})
