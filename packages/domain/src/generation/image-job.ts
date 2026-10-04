import { z } from 'zod'
import { CharacterId, ImageGenerationJobId, MediaAssetId, ProjectId, ShotId } from '../common/ids.js'
import { ModelId, ProviderId } from './take.js'

/**
 * 絵を 1 枚作るジョブ（ADR-0029）。種類は 2 つ。
 * - `start_frame`: 絵コンテの画像。Shot の「最初のフレーム」になる絵
 * - `character_sheet`: キャラクターシート（四面図）。手本の画像 1 枚から作り、識別画像の四面図に足す
 *   （制作者 2026-10-03「動画生成に役立つ形式のキャラクターシートを 1 枚の画像から作れるといい」。ADR-0035）
 *
 * **Codex は 1 度に 1 枚**なので、どちらも同じジョブ・同じ順番待ちで作る（別にすると 2 つが同時に Codex を呼ぶ）。
 *
 * **追記のみ。** 作り直しても前のジョブとできた絵は残す（Take と同じ考え。ADR-0003）。
 * 最初のフレームとして使うのは、そのとき差し替えた 1 枚（`ShotReference` が正）。
 */

export const ImageJobKind = z.enum(['start_frame', 'character_sheet'])
export type ImageJobKind = z.infer<typeof ImageJobKind>

/**
 * `cancelled` は人が止めた（制作者 2026-10-04「画像生成も停められるようにしよう」）。失敗ではないので理由を持たない。
 * **止めた行は、作っている側の書き込み（作成中・成功・失敗）で上書きしない**（リポジトリが守る）。
 */
export const ImageGenerationJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
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
  kind: ImageJobKind,
  /** 最初のフレームを作る Shot。キャラクターシートなら null。 */
  shotId: ShotId.nullable(),
  /** シートを作るキャラクター。最初のフレームなら null。 */
  characterId: CharacterId.nullable(),
  status: ImageGenerationJobStatus,
  providerId: ProviderId,
  modelId: ModelId,
  /**
   * 参照に使った素材。最初のフレームは実行時に決まる（登場人物・衣装・場所）ので、待っている間は空。
   * キャラクターシートは頼んだときに決まる（手本の画像 1 枚）。
   */
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
  job: Pick<ImageGenerationJob, 'kind' | 'shotId' | 'characterId' | 'status' | 'mediaAssetId' | 'error'>,
): string | null => {
  // 種類と持ち主: 最初のフレームは Shot だけ、キャラクターシートはキャラクターだけを持つ。
  if (job.kind === 'start_frame' && job.shotId === null) return '最初のフレームのジョブなのに Shot がありません'
  if (job.kind === 'start_frame' && job.characterId !== null) return '最初のフレームのジョブなのにキャラクターがあります'
  if (job.kind === 'character_sheet' && job.characterId === null) return 'キャラクターシートのジョブなのにキャラクターがありません'
  if (job.kind === 'character_sheet' && job.shotId !== null) return 'キャラクターシートのジョブなのに Shot があります'
  if (job.status === 'succeeded' && job.mediaAssetId === null) return '成功したのに絵がありません'
  if (job.status === 'failed' && job.error === null) return '失敗したのに理由がありません'
  if (job.status !== 'succeeded' && job.mediaAssetId !== null) return 'まだ終わっていないのに絵があります'
  if (job.status !== 'failed' && job.error !== null) return '失敗していないのに理由があります'
  return null
}
