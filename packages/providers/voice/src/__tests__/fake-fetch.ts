import type { FetchLike } from '../http.js'

/** 偽の fetch。送った URL・ヘッダー・本文を控える（本文は文字列か FormData だけ）。 */
export type FakeCall = {
  readonly url: string
  readonly headers: Headers
  readonly body: string
  readonly form: FormData | null
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const createFetch = (
  handler: (url: string) => Response | Promise<Response>,
): { readonly calls: FakeCall[]; readonly fetch: FetchLike } => {
  const calls: FakeCall[] = []
  const fetch: FetchLike = (url, init) => {
    calls.push({
      url,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : '',
      form: init.body instanceof FormData ? init.body : null,
    })
    return Promise.resolve(handler(url))
  }
  return { calls, fetch }
}

/** 送った JSON の本文。 */
export const sentJson = (call: FakeCall | undefined): unknown => JSON.parse(call?.body ?? 'null') as unknown
