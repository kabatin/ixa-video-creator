import { createHmac, timingSafeEqual } from 'node:crypto'
import type { StorageKey } from './port.js'

/**
 * 手元のファイルを配信するときの署名（ADR-0041）。
 *
 * MinIO をやめると署名付き URL を出す人がいなくなるので、API が出す。
 * **純粋な関数にしておく**（鍵と時刻は呼び出し側が渡す）。期限切れ・改竄・鍵違いを
 * ファイルも HTTP も無しに試験できるようにするため。
 */

/** 鍵の最低の長さ。短い鍵を黙って受け取らない。 */
export const MIN_SIGNING_SECRET_LENGTH = 32

export type StorageAccessMethod = 'GET' | 'PUT'

export type StorageAccess = {
  /**
   * 読むための署名と、書くための署名を**別のものにする**。
   * 同じにすると、読む URL を受け取った人がそのまま上書きできてしまう。
   */
  readonly method: StorageAccessMethod
  readonly key: StorageKey
  /** 期限（unix 秒）。 */
  readonly expiresAtSec: number
  /** PUT のときだけ使う。GET では省く。 */
  readonly contentType?: string
}

/** 署名の対象を 1 本の文字列にする。項目は改行で区切り、継ぎ目で入れ替えが起きないようにする。 */
const canonicalize = (access: StorageAccess): string =>
  [access.method, access.key, String(access.expiresAtSec), access.contentType ?? ''].join('\n')

const assertSecret = (secret: string): void => {
  if (secret.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new Error(
      `署名の鍵が短すぎます（${String(MIN_SIGNING_SECRET_LENGTH)} 文字以上にしてください）`,
    )
  }
}

export const signStorageAccess = (access: StorageAccess, secret: string): string => {
  assertSecret(secret)
  return createHmac('sha256', secret).update(canonicalize(access)).digest('hex')
}

export type SignatureCheck =
  | { readonly ok: true }
  /** `mismatch` は鍵違い・改竄・形が違うものすべて。**呼び出し側は理由を利用者に伝えない。** */
  | { readonly ok: false; readonly reason: 'mismatch' | 'expired' }

/**
 * 署名を確かめる。**先に署名、次に期限**の順で見る。
 * 期限を先に見ると、期限を書き換えただけの URL を「期限切れ」と答えてしまい、
 * 改竄と見分けが付かなくなる。
 */
export const verifyStorageAccess = (
  input: StorageAccess & { readonly signature: string; readonly nowMs: number },
  secret: string,
): SignatureCheck => {
  const expected = signStorageAccess(
    {
      method: input.method,
      key: input.key,
      expiresAtSec: input.expiresAtSec,
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
    },
    secret,
  )

  // timingSafeEqual は長さが違うと throw するので、先に長さで落とす。
  const given = Buffer.from(input.signature, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'mismatch' }
  }
  if (Math.floor(input.nowMs / 1000) > input.expiresAtSec) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}
