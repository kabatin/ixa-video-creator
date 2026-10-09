import { NextResponse, type NextRequest } from 'next/server'

/**
 * 合言葉のクッキーが無ければ入り口へ送る（認証。2026-10-09）。
 *
 * **ここではクッキーがあるかだけを見る。** 本物かどうかは API の門が確かめる
 * （取り消した・切れた鍵なら、画面が 401 を受けて入り口へ送る）。ここで先に送るのは、
 * 中身の無い画面を一度描いてから飛ぶのを避けるため。
 */

/** API が付けるクッキーの名前（`apps/api/src/auth/gate.ts` の `SESSION_COOKIE` と同じ）。 */
const SESSION_COOKIE = 'ixa_session'

export const middleware = (request: NextRequest): NextResponse => {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()
  const url = request.nextUrl.clone()
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`
  url.pathname = '/login'
  url.search = next === '/' ? '' : `?next=${encodeURIComponent(next)}`
  return NextResponse.redirect(url)
}

/** 入り口そのものと、画面を描くのに要るファイル（Next の内部・アイコン）は通す。 */
export const config = {
  matcher: ['/((?!login|_next/|icon\\.svg|favicon\\.ico).*)'],
}
