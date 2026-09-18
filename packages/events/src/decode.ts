import { ProjectEvent } from '@ixa/domain'
import type { ZodError } from 'zod'

export type DecodedProjectEvent =
  | { readonly ok: true; readonly event: ProjectEvent }
  | { readonly ok: false; readonly reason: string }

/**
 * zod の指摘を「どこが・どの種類で」だけに縮める。
 * **受け取った値そのものは入れない。** 理由はログに流れるため。
 */
const summarizeIssues = (error: ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`).join(', ')

/**
 * Redis から受けた文字列を出来事へ戻す。読めなければ理由付きで返す。**投げない。**
 * 1 件読めなかっただけで購読ごと落とすと、他の正しい出来事まで届かなくなる。
 */
export const decodeProjectEvent = (raw: string): DecodedProjectEvent => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    // Node の JSON.parse は本文の一部を例外メッセージに載せる。そのまま残すと
    // 中身がログへ漏れるので、理由は固定の文言にする。
    return { ok: false, reason: 'JSON として読めない' }
  }

  const parsed = ProjectEvent.safeParse(json)
  return parsed.success
    ? { ok: true, event: parsed.data }
    : { ok: false, reason: summarizeIssues(parsed.error) }
}
