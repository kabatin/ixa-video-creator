import type { Verdict } from '../review/review.js'
import type { ShotStatus } from '../shot/shot.js'
import type { ReviewStatus } from './take.js'

/**
 * 動画の Take がレビューで NG のときに、自動で作り直すか（ADR-0057。制作者の要望 2026-10-23）。
 *
 * レビューと作り直しは時間とトークンを多く使う。**既定は作り直さず、作り直しを勧めるだけ**にする。
 * 生成を頼むときに「NG なら自動で作り直す」を選んだときだけ、今までどおり上限つきで作り直す（夜間に自走させる用）。
 * 選んだ値は頼んだ時点でジョブに残し（`GenerationJob.autoRetake`）、Take に写す。後から全体の設定で変わらない。
 *
 * - `regenerate`: 作り直しを積む（上限の判定は `canRegenerate` が持つ）
 * - `recommend`: 作り直さない。画面に「作り直し推奨」と理由を出す
 * - `none`: 何もしない（合格・警告・判定なし。警告は人が見る）
 */
export type ActionAfterReview = 'regenerate' | 'recommend' | 'none'

export const actionAfterReview = (input: {
  readonly verdict: Verdict | null
  readonly autoRetake: boolean
}): ActionAfterReview => {
  if (input.verdict !== 'fail') return 'none'
  return input.autoRetake ? 'regenerate' : 'recommend'
}

/**
 * 画面に「作り直し推奨」と出すか（ADR-0057）。レビューが不合格で、次のどちらか。
 * - 自動の作り直しを選んでいない（既定）
 * - 選んでいたが、自動の作り直しが止まった（上限・予算・人の判断が要る。Shot が `blocked`）。最後の Take に勧めを残す
 *
 * 自動の作り直しが続いている間は勧めない（次の Take が来る）。Shot の状態が分からなければ `null`（選んでいない Take だけ勧める）。
 */
export const isRetakeRecommended = (
  take: { readonly reviewStatus: ReviewStatus; readonly autoRetake: boolean },
  shotStatus: ShotStatus | null,
): boolean => take.reviewStatus === 'failed' && (!take.autoRetake || shotStatus === 'blocked')

/**
 * Take ができたら自動でレビューを積むか（ADR-0057）。自動の作り直しを選んだ Take で、まだレビューしていないものだけ。
 * 選んでいなければ積まない（既定。レビューは人が頼む）。複製で写した Take も積まない（この作品で作っていない）。
 */
export const shouldAutoReview = (take: {
  readonly autoRetake: boolean
  readonly reviewStatus: ReviewStatus
  readonly copiedFromTakeId: string | null
}): boolean => take.autoRetake && take.reviewStatus === 'pending' && take.copiedFromTakeId === null
