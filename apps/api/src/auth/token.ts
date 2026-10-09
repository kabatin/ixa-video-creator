import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * 鍵と合言葉の扱い（認証）。
 *
 * - 鍵は 32 バイトの乱数。推測も総当たりもできないので、保存はただの SHA-256 で足りる（塩は要らない）
 * - 合言葉の比べ方は**時間で漏らさない**（`timingSafeEqual`）。長さの違いも漏らさないよう、両方をハッシュにしてから比べる
 */

const TOKEN_BYTES = 32

/** 新しい鍵（URL に載せても壊れない形）。 */
export const issueToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url')

/** 表に残す形。**鍵そのものは残さない。** */
export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

export const passphraseMatches = (input: string, expected: string): boolean =>
  timingSafeEqual(digest(input), digest(expected))
