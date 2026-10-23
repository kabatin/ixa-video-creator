import type { Verdict } from '../review/review.js'
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
 * 画面に「作り直し推奨」と出すか（ADR-0057）。レビューが不合格で、自動の作り直しを選んでいない Take。
 * 自動の作り直しを選んだ Take は作り直しが走る（上限に触れたら Shot が止まり、そちらで分かる）。
 */
export const isRetakeRecommended = (take: { readonly reviewStatus: ReviewStatus; readonly autoRetake: boolean }): boolean =>
  take.reviewStatus === 'failed' && !take.autoRetake
