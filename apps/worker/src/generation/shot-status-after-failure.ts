import type { GenerationJobId, GenerationJobStatus, ShotStatus } from '@ixa/domain'

/**
 * 生成が失敗したとき、Shot を何にするか（純粋関数）。
 *
 * **なぜ要るか。** 生成に回すとき API が Shot を `generating` にする
 * （`apps/api/src/routes/shots.ts`）。成功したときは worker が `review` へ戻すが、
 * 失敗したときに戻す経路が無かった。結果、失敗した Shot は DB ごと `generating` で
 * 固まり、画面の生成ボタンが二度と押せなくなっていた。
 *
 * **1 つの Shot に複数のジョブが並ぶ。** 3 本頼んで 1 本だけ失敗することがあるので、
 * 1 本の失敗だけで結論を出さない。
 */

/** まだ終わっていないジョブ。これが残っている間は結論を出さない。 */
const PENDING: ReadonlySet<GenerationJobStatus> = new Set<GenerationJobStatus>(['queued', 'running'])

export type ShotFailureContext = {
  /** その Shot のジョブすべて。いま失敗したものを含んでよい。 */
  readonly jobs: readonly {
    readonly id: GenerationJobId
    readonly status: GenerationJobStatus
  }[]
  /** いま失敗したジョブ。残りを数えるときにこれを除く。 */
  readonly failedJobId: GenerationJobId
  /** その Shot に Take が 1 本でもあるか。 */
  readonly hasTakes: boolean
}

/**
 * **`null` は「まだ動かさない」。** `generating` のままにする、という意味であって
 * 「何もしなくてよい」ではない。ほかのジョブが走っている間に状態を確定させると、
 * あとから成功した Take が届いたときに食い違う。
 *
 * 残りが無くなったときだけ決める。
 * - Take がある → `review`。失敗した本数はあっても、見るものはできている。
 * - Take が 1 本も無い → `blocked`（要判断）。
 *   `ready` へ戻さないのは、**失敗の痕跡が消えて一覧から気づけなくなる**ため。
 */
export const shotStatusAfterFailure = (ctx: ShotFailureContext): ShotStatus | null => {
  const stillRunning = ctx.jobs.some(
    (job) => job.id !== ctx.failedJobId && PENDING.has(job.status),
  )
  if (stillRunning) return null
  return ctx.hasTakes ? 'review' : 'blocked'
}
