/**
 * DB の失敗を「動いていないだけ」か「それ以外」かに分ける（純粋）。
 *
 * 動いていないだけ（つながらない・時間切れ）なら、worker も動けないので動いているジョブは無いと言える。
 * それ以外（合言葉違い・表が無い・名前を引けない）は数えられていないだけなので、**黙って 0 件にしない。**
 * 判定は `code` だけで見る（文に接続先が入ることがあるので、文は表示にも判定にも使わない）。
 */

const UNREACHABLE_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET'])

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined

const causeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined

export const isUnreachable = (error: unknown, depth = 5): boolean => {
  const code = codeOf(error)
  if (code !== undefined && UNREACHABLE_CODES.has(code)) return true
  const cause = causeOf(error)
  return depth > 0 && cause !== undefined && isUnreachable(cause, depth - 1)
}

/** いちばん外から見て最初の code（drizzle と packages/db が 2 重に包むので cause をたどる）。 */
const firstCode = (error: unknown, depth = 5): string | undefined =>
  codeOf(error) ?? (depth > 0 && causeOf(error) !== undefined ? firstCode(causeOf(error), depth - 1) : undefined)

/** 表示してよい短い理由（code だけ）。 */
export const dbErrorReason = (error: unknown): string => {
  if (isUnreachable(error)) return 'つながりません'
  const code = firstCode(error)
  return code === undefined ? '読めません' : `読めません（${code}）`
}
