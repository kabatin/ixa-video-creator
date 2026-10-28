import { z } from 'zod'
import type { AiToolId } from './ai-tools.js'

/**
 * AI のチェック（ADR-0066）。描いた絵（ADR-0055）と動画の Take（自動レビューの画像を見る判定。ADR-0005）を
 * Claude が見るか。**既定はどちらも切る**（制作者 2026-10-28「トークン消費激しすぎる」）。
 *
 * 入れても、文章の AI が Claude のときだけ見る（画像を見られる口は Claude CLI だけ）。
 * 決まった規則で測るレビュー（技術・曲・ブランド）はここに関わらず動く。
 */
export const AiChecks = z.object({
  /** 描いた絵（最初のフレーム・キャラクターシート・キーアート）を見て、NG なら描き直す。 */
  image: z.boolean(),
  /** 動画の Take を、自動レビューで画像として見る。 */
  video: z.boolean(),
})
export type AiChecks = z.infer<typeof AiChecks>

export type AiCheckTarget = keyof AiChecks

/** 既定（どちらも切る）。行が無いとき・列が無かった頃の行もこれになる。 */
export const AI_CHECKS_OFF: AiChecks = Object.freeze({ image: false, video: false })

/**
 * Claude で見るか。**規則はここ 1 か所**（絵と Take が同じ順で決める）。
 * - `off`: チェックを切っている
 * - `not_claude`: 入れているが、文章の AI が Claude ではない
 * - `claude`: Claude で見る
 */
export type AiCheckGate = 'claude' | 'off' | 'not_claude'

export const aiCheckGate = (
  settings: { readonly text: AiToolId; readonly checks: AiChecks },
  target: AiCheckTarget,
): AiCheckGate => {
  if (!settings.checks[target]) return 'off'
  return settings.text === 'claude_cli' ? 'claude' : 'not_claude'
}
