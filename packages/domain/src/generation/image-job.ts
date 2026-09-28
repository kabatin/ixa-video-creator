import { z } from 'zod'
import { ImageGenerationJobId, MediaAssetId, ProjectId, ShotId } from '../common/ids.js'
import { ModelId, ProviderId } from './take.js'

/**
 * 絵コンテの画像を作るジョブ（ADR-0029）。Shot の「最初のフレーム」になる絵を 1 枚作る。
 *
 * **追記のみ。** 作り直しても前のジョブとできた絵は残す（Take と同じ考え。ADR-0003）。
 * 最初のフレームとして使うのは、そのとき差し替えた 1 枚（`ShotReference` が正）。
 */

export const ImageGenerationJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type ImageGenerationJobStatus = z.infer<typeof ImageGenerationJobStatus>

export const ImageGenerationJobError = z.object({
  code: z.string().min(1),
  /** 利用者にそのまま見せる文（内部の参照や実装の言葉を入れない）。 */
  message: z.string().min(1),
  retryable: z.boolean(),
})
export type ImageGenerationJobError = z.infer<typeof ImageGenerationJobError>

/**
 * 検査（`imageJobViolation`）は **ここには付けない**。`.refine()` を付けると `omit` / `pick` が
 * 使えなくなり、API の形などの派生が作れなくなる（`GenerationJob` と同じ方針）。
 */
export const ImageGenerationJob = z.object({
  id: ImageGenerationJobId,
  projectId: ProjectId,
  shotId: ShotId,
  status: ImageGenerationJobStatus,
  providerId: ProviderId,
  modelId: ModelId,
  /** 参照に使った素材（登場人物・衣装・場所）。実行時に決まるので、待っている間は空。 */
  referenceAssetIds: z.array(MediaAssetId),
  /** できた絵。成功したときだけ。 */
  mediaAssetId: MediaAssetId.nullable(),
  error: ImageGenerationJobError.nullable(),
  /** 再現用の記録（CLI の版・終了コードなど）。**指示の本文は入れない。** */
  providerRecord: z.record(z.unknown()).nullable(),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type ImageGenerationJob = z.infer<typeof ImageGenerationJob>

/**
 * 状態と中身が食い違っていないか。破れていれば理由、成り立っていれば null。
 *
 * 成功なら絵があり、失敗なら理由があり、それ以外はどちらも無い。
 * **規則はここ 1 箇所。** 作る側も読み直す側もこれを呼ぶ（lessons L-016）。
 */
export const imageJobViolation = (
  job: Pick<ImageGenerationJob, 'status' | 'mediaAssetId' | 'error'>,
): string | null => {
  if (job.status === 'succeeded' && job.mediaAssetId === null) return '成功したのに絵がありません'
  if (job.status === 'failed' && job.error === null) return '失敗したのに理由がありません'
  if (job.status !== 'succeeded' && job.mediaAssetId !== null) return 'まだ終わっていないのに絵があります'
  if (job.status !== 'failed' && job.error !== null) return '失敗していないのに理由があります'
  return null
}
