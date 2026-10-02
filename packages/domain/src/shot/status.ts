import type { ShotStatus } from './shot.js'

/**
 * 生成や採用が落ち着いたあとの Shot の状態（純粋関数。ADR-0023）。
 *
 * **採用が決定。** 人がいちばん意思を込める操作は「どの Take を使うか」なので、
 * 採用している Take があれば `approved`（画面: 採用済み）。別の「承認」は無い。
 *
 * 以前はこの判断が 3 箇所に分かれていた（API の採用・worker の成功・worker の失敗）。
 * API だけ直しても、採用済みの Shot で作り直しを試すと worker が `review` へ戻し、
 * 「採用待ち」に落ちる。**判断は 1 つにして、全員がここを引く。**
 *
 * - 採用している Take がある → `approved`
 * - Take はあるが採用していない → `review`（画面: 採用待ち）
 * - Take が 1 本も無い → `blocked`（要判断）。`ready` に戻すと失敗の痕跡が消える
 */
export type SettledShotContext = {
  readonly hasSelectedTake: boolean
  readonly hasTakes: boolean
}

export const settledShotStatus = ({ hasSelectedTake, hasTakes }: SettledShotContext): ShotStatus => {
  if (hasSelectedTake) return 'approved'
  return hasTakes ? 'review' : 'blocked'
}

/**
 * 制作者が生成をやめたあとの Shot の状態（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい」）。
 *
 * Take があれば `settledShotStatus` と同じ。**Take が 1 本も無ければ `draft`**（生成する前に戻す）。
 * やめたのは人の判断で失敗ではないので、`blocked`（要判断）にして痕跡を残す理由が無い。
 */
export const shotStatusAfterCancel = (ctx: SettledShotContext): ShotStatus =>
  ctx.hasSelectedTake || ctx.hasTakes ? settledShotStatus(ctx) : 'draft'
