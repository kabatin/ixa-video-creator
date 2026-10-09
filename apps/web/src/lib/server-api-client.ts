import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createApiClient, resolveApiBaseUrl, type ApiClient } from '@/lib/api-client'
import { ApiError } from '@/lib/api-error'
import { LOGIN_PATH } from '@/lib/http'

/**
 * Next のサーバ側から API を呼ぶ口（認証。2026-10-09）。**サーバ側の画面だけが import する。**
 *
 * サーバ側の呼び出しはブラウザを通らないので、クッキーが勝手には付かない。
 * 来た要求の**合言葉のクッキーだけ**をそのまま API へ渡す（ほかのクッキーは渡さない）。
 */

/**
 * API が付けるクッキーの名前（`apps/api/src/auth/gate.ts` の `SESSION_COOKIE` と同じ）。
 * `middleware.ts` も同じ名前を持つ（middleware は別の実行環境で動くので、ここを import しない）。
 * 名前の一致は `auth-cookie-name.test.ts` が確かめる。
 */
export const SESSION_COOKIE = 'ixa_session'

export const createServerApiClient = async (): Promise<ApiClient> => {
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  return createApiClient(
    resolveApiBaseUrl(),
    session === undefined ? {} : { cookie: `${SESSION_COOKIE}=${session}` },
  )
}

/**
 * 鍵が切れていたら入り口へ。**それ以外の失敗は何もしない**（呼び出し側がいつもどおり表示する）。
 * `redirect` は投げて抜けるので、catch の中で呼べばそのまま入り口へ移る。
 */
export const redirectIfUnauthenticated = (error: unknown): void => {
  if (error instanceof ApiError && error.status === 401) redirect(LOGIN_PATH)
}
