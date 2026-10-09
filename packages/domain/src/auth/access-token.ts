import { z } from 'zod'
import { AccessTokenId } from '../common/ids.js'

/**
 * API に入るための鍵（認証。制作者 2026-10-09「3 はまず認証の仕組みを追加しましょうか」）。
 *
 * 使う人は 1 人（制作者）。アカウントは作らず、**合言葉で入った端末**と**自動化用の鍵**（MCP 向け）を
 * 同じ形で持つ。どちらも取り消せる。
 *
 * **鍵そのものはここに無い。** 表に残すのはハッシュだけで、鍵はクッキーか、発行したその場の画面にしか出ない。
 */

/** `browser` は合言葉で入った端末（クッキー）。`automation` は画面で発行した鍵（Bearer）。 */
export const AccessTokenKind = z.enum(['browser', 'automation'])
export type AccessTokenKind = z.infer<typeof AccessTokenKind>

export const AccessToken = z.object({
  id: AccessTokenId,
  kind: AccessTokenKind,
  /** 画面に出す名前（自動化用は人が付ける。端末は「ブラウザ」と入った日時から付ける）。 */
  label: z.string().trim().min(1).max(80),
  createdAt: z.date(),
  /** 期限。**自動化用は無期限（null）**——取り消すまで使える。端末は 30 日。 */
  expiresAt: z.date().nullable(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
})
export type AccessToken = z.infer<typeof AccessToken>

/** 合言葉で入った端末が入ったままでいられる日数。 */
export const BROWSER_SESSION_DAYS = 30

/**
 * いま使える鍵か。**取り消し済み・期限切れは使えない。** 理由を返す（使えるなら null）。
 * 時刻は引数で受ける（domain は時計を持たない）。
 */
export const accessTokenRejection = (
  token: Pick<AccessToken, 'expiresAt' | 'revokedAt'>,
  now: Date,
): 'revoked' | 'expired' | null => {
  if (token.revokedAt !== null) return 'revoked'
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) return 'expired'
  return null
}
