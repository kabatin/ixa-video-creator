import { z } from 'zod'
import { DubJobId, ProjectId, ShotId, TakeId } from '../common/ids.js'
import { MAX_DUB_TIME_SEC } from './dialogue-dub.js'
import { DubParams } from './dub-record.js'

/**
 * 声を差し替える仕事（ADR-0062 段 5b）。採用中の Take の音を、キャラクターのセリフの声で読み直した**新しい Take** を作る。
 *
 * - **追記のみ**。更新は状態の遷移（queued → running → succeeded / failed / cancelled）と、そのとき決まる列だけ
 * - 元の Take も、出来た Take も消さない（Take と同じ考え。ADR-0003）
 * - 止めた行（`cancelled`）は、作っている側の書き込みで上書きしない（リポジトリが守る）
 */

/** 差し替えた Take に残す理由（`Take.regenerationReason`）。数えるときにこの文字で引く。 */
export const DUB_REASON = 'dub'

export const DubJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type DubJobStatus = z.infer<typeof DubJobStatus>

export const ACTIVE_DUB_JOB_STATUSES: readonly DubJobStatus[] = ['queued', 'running']

const Sec = z.number().finite().min(0).max(MAX_DUB_TIME_SEC)

/** 行の手の区間の案（2 人のセリフが 1 つの区間にまとまって止まったとき。画面が各行に先に入れておく）。 */
export const DubLineSpanSuggestion = z
  .object({ lineIndex: z.number().int().min(0).max(19), startSec: Sec, endSec: Sec })
  .strict()
  .refine((span) => span.endSec > span.startSec, { message: '区間の終わりは始まりより後にしてください', path: ['endSec'] })
export type DubLineSpanSuggestion = z.infer<typeof DubLineSpanSuggestion>

export const DubJobError = z
  .object({
    code: z.string().min(1).max(60),
    /** 利用者にそのまま見せる文（日本語。鍵・内部の参照・実装の言葉を入れない）。 */
    message: z.string().min(1).max(1000),
    retryable: z.boolean(),
    /** 行の区間が決まらなかったときの、行ごとの手の区間の案。 */
    suggestedSpans: z.array(DubLineSpanSuggestion).max(20).optional(),
  })
  .strict()
export type DubJobError = z.infer<typeof DubJobError>

/** 検査（`dubJobViolation`）はここに付けない（`.refine()` を付けると `omit` / `pick` が使えなくなる。`UpscaleJob` と同じ方針）。 */
export const DubJob = z.object({
  id: DubJobId,
  projectId: ProjectId,
  shotId: ShotId,
  /** 元の Take（積んだときの採用中の Take）。**これが入力そのもの。** */
  sourceTakeId: TakeId,
  status: DubJobStatus,
  /** 出来た Take。成功したときだけ。 */
  takeId: TakeId.nullable(),
  /** 払った額（読み上げ。保存済みを使った行は 0）。 */
  costUsd: z.number().nonnegative(),
  error: DubJobError.nullable(),
  /** 行ごとの記録（出来た Take の `providerParams` と同じもの）。成功したときだけ。 */
  record: DubParams.nullable(),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type DubJob = z.infer<typeof DubJob>

/** 状態と中身が食い違っていないか。破れていれば理由、成り立っていれば null（規則はここ 1 か所。L-016）。 */
export const dubJobViolation = (job: Pick<DubJob, 'status' | 'takeId' | 'error' | 'record'>): string | null => {
  if (job.status === 'succeeded' && (job.takeId === null || job.record === null)) return '成功したのに Take か記録がありません'
  if (job.status === 'failed' && job.error === null) return '失敗したのに理由がありません'
  if (job.status !== 'succeeded' && job.takeId !== null) return 'まだ終わっていないのに Take があります'
  if (job.status !== 'failed' && job.error !== null) return '失敗していないのに理由があります'
  return null
}

export const DUB_NO_DIALOGUE_REASON = 'セリフの行がありません'
export const DUB_NO_TAKE_REASON = '採用している Take がありません'
export const DUB_GENERATING_REASON = '動画を作っている最中です。できてから差し替えてください'
export const DUB_IN_PROGRESS_REASON = 'この Shot の声を差し替えている最中です'
export const DUB_NO_AUDIO_REASON = '採用している Take に音がありません（音付きで作った Take だけ差し替えられます）'
export const DUB_ALL_KEPT_REASON = 'すべての行が「元の声のまま」です'

/**
 * その Shot の声を差し替えられるか。差し替えられない理由、または null。
 * **画面（押せないボタンの理由）と API（断る理由）が同じものを呼ぶ**（規則を 2 か所に書かない。L-016）。
 * 話し手のセリフの声・鍵の名札・行の区間は、作る側（worker）が確かめる（声と音を読まないと決まらない）。
 */
export const dubBlocker = (input: {
  readonly shot: {
    readonly status: string
    readonly selectedTakeId: string | null
    readonly dialogue: readonly { readonly dub?: { readonly keepOriginal?: boolean | undefined } | undefined }[]
  }
  /** 採用 Take の音があるか。測っていなければ null（作る側が確かめる）。 */
  readonly sourceHasAudio: boolean | null
  /** この Shot の差し替えの仕事が、待っているか動いているか。 */
  readonly active: boolean
}): string | null => {
  if (input.shot.dialogue.length === 0) return DUB_NO_DIALOGUE_REASON
  if (input.shot.dialogue.every((line) => line.dub?.keepOriginal === true)) return DUB_ALL_KEPT_REASON
  if (input.shot.status === 'generating') return DUB_GENERATING_REASON
  if (input.active) return DUB_IN_PROGRESS_REASON
  if (input.shot.selectedTakeId === null) return DUB_NO_TAKE_REASON
  if (input.sourceHasAudio === false) return DUB_NO_AUDIO_REASON
  return null
}

/** 差し替えた Take の記録。差し替えた Take でなければ null（字幕の時刻・結果の表が読む）。 */
export const dubRecordOf = (take: { readonly providerParams: { readonly kind: string } }): DubParams | null => {
  if (take.providerParams.kind !== 'dub') return null
  const parsed = DubParams.safeParse(take.providerParams)
  return parsed.success ? parsed.data : null
}
