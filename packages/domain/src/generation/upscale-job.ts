import { z } from 'zod'
import { ProjectId, ShotId, TakeId, UpscaleJobId } from '../common/ids.js'
import { ModelId, ProviderId } from './take.js'

/**
 * 出来上がった Take の**解像度を上げる**仕事（ADR-0044 / FlashVSR）。
 *
 * 「本番で作り直す」（ADR-0042）との違いは、**絵が変わらない**こと。作り直しは同じシードでも
 * 大きさが変われば別の絵になるが、これは採用した絵をそのまま保って細部だけを足す。
 *
 * **生成（`GenerationJob`）とは別の仕事にしてある。** `GenerationJob` は「仕様から作る」ための
 * 行で、worker は行から仕様を組み直して `specHash` を突き合わせる（L-012 / `spec_drift`）。
 * **解像度を上げる仕事には組み直す仕様が無い。** 相乗りさせるとその突き合わせに例外が要り、
 * 2 回落ちた仕掛けを緩めることになる。仕様を持たない生成の前例（`ImageGenerationJob`）に倣う。
 *
 * **追記のみ。** 出来たものは元の Take の隣に積み、元は消さない（Take と同じ考え。ADR-0003）。
 */

/**
 * 上げた Take に残す理由（`Take.regenerationReason`）。
 * **1 本ずつ押す経路とまとめて積む経路で同じ文字にする**（違う文字だと後から数えられない）。
 */
export const UPSCALE_REASON = '解像度を上げる'

/**
 * `cancelled` は人が止めた。失敗ではないので理由を持たない。
 * **止めた行は、作っている側の書き込みで上書きしない**（リポジトリが守る。絵の仕事と同じ）。
 */
export const UpscaleJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type UpscaleJobStatus = z.infer<typeof UpscaleJobStatus>

export const UpscaleJobError = z.object({
  code: z.string().min(1),
  /** 利用者にそのまま見せる文（内部の参照や実装の言葉を入れない）。 */
  message: z.string().min(1),
  retryable: z.boolean(),
})
export type UpscaleJobError = z.infer<typeof UpscaleJobError>

/**
 * 検査（`upscaleJobViolation`）は **ここには付けない**。`.refine()` を付けると `omit` / `pick` が
 * 使えなくなり、API の形などの派生が作れなくなる（`GenerationJob` と同じ方針）。
 */
export const UpscaleJob = z.object({
  id: UpscaleJobId,
  projectId: ProjectId,
  shotId: ShotId,
  /** 元にする Take。**これが入力そのもの**（仕様ではなく、出来上がった動画を渡す）。 */
  sourceTakeId: TakeId,
  status: UpscaleJobStatus,
  providerId: ProviderId,
  modelId: ModelId,
  /** 出来上がった Take。成功したときだけ。**成果物は素材ではなく Take**。 */
  takeId: TakeId.nullable(),
  /** 生成先のジョブ ID。送ったあとだけ入る（問い合わせと取消に要る）。 */
  providerJobRef: z.string().nullable(),
  error: UpscaleJobError.nullable(),
  /**
   * 生成先が投入時に返した見込み（秒）。**走っている間の「あと何分」はこれを正とする。**
   * 返さないサーバ・古い版では null（そのときだけ、こちら側の式に落とす）。
   */
  estimateSeconds: z.number().nonnegative().nullable(),
  /** 再現用の記録（workflow 名・生成先のジョブ ID など）。**動画の中身は入れない。** */
  providerRecord: z.record(z.unknown()).nullable(),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type UpscaleJob = z.infer<typeof UpscaleJob>

/**
 * 状態と中身が食い違っていないか。破れていれば理由、成り立っていれば null。
 *
 * **規則はここ 1 箇所。** 作る側も読み直す側もこれを呼ぶ（L-016）。
 */
export const upscaleJobViolation = (
  job: Pick<UpscaleJob, 'status' | 'takeId' | 'error'>,
): string | null => {
  if (job.status === 'succeeded' && job.takeId === null) return '成功したのに Take がありません'
  if (job.status === 'failed' && job.error === null) return '失敗したのに理由がありません'
  if (job.status !== 'succeeded' && job.takeId !== null) return 'まだ終わっていないのに Take があります'
  if (job.status !== 'failed' && job.error !== null) return '失敗していないのに理由があります'
  return null
}

/** 解像度を上げるのに要る Take の情報だけ。`Take` をそのまま渡せる。 */
export type UpscaleSourceTake = Pick<TakeForUpscale, 'id' | 'regenerationReason'>
type TakeForUpscale = { readonly id: TakeId; readonly regenerationReason: string | null }

export const ALREADY_UPSCALED_REASON = 'この Take は、すでに解像度を上げたものです'
export const UPSCALE_IN_PROGRESS_REASON = 'この Take は、いま解像度を上げている最中です'
export const UPSCALE_EXISTS_REASON = 'この Take の解像度を上げたものが、すでにあります'

/**
 * その Take を上げられるか。上げられない理由、または `null`。
 *
 * **押しても必ず断られる操作を、押せる形で画面に出さないため**の判定でもある。
 * 画面と API の両方がこれを呼ぶ（規則を 2 か所に書かない。L-016）。
 *
 * - 上げたものをさらに上げない（粗が重なるだけで、良くならない）
 * - 同じ Take を二重に積まない（夜にまとめて押す操作なので、2 回押されうる）
 */
export const upscaleBlocker = (input: {
  readonly take: UpscaleSourceTake
  /** その Shot の Take 全部（見えなくしたものも含める。隠しても二重には作らない）。 */
  readonly siblings: readonly UpscaleSourceTakeWithParent[]
  /** いま動いている（順番待ち・作成中）仕事が指している元 Take。 */
  readonly activeSourceTakeIds: readonly TakeId[]
}): string | null => {
  if (input.take.regenerationReason === UPSCALE_REASON) return ALREADY_UPSCALED_REASON
  if (input.activeSourceTakeIds.includes(input.take.id)) return UPSCALE_IN_PROGRESS_REASON
  const done = input.siblings.some(
    (sibling) =>
      sibling.parentTakeId === input.take.id && sibling.regenerationReason === UPSCALE_REASON,
  )
  return done ? UPSCALE_EXISTS_REASON : null
}

export type UpscaleSourceTakeWithParent = UpscaleSourceTake & {
  readonly parentTakeId: TakeId | null
}
