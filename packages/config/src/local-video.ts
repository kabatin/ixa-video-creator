import type { Env } from './schema.js'

/**
 * 手元の生成サーバ（vpipe-api）の設定の食い違いを起動時に止める（ADR-0030）。
 *
 * vpipe-api は、ループバック以外で待ち受けるならトークン無しでは起動しない。
 * だからこのマシンの外を指しているのにトークンが無い設定は、**必ず 401 で失敗する**。
 * それを生成を押すたびに（最初のフレームの画像を送りつけてから）知るのではなく、起動した時点で知らせる。
 */

const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '[::1]', '::1']
const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/

/** このマシンの中だけを指す URL か。読めない URL は外とみなす（安全な側へ倒す）。 */
export const isLoopbackUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url)
    const host = hostname.toLowerCase()
    return LOOPBACK_HOSTNAMES.includes(host) || IPV4_LOOPBACK.test(host)
  } catch {
    return false
  }
}

/** 食い違いがあれば理由の文を返す。**値（URL やトークン）は文に入れない。** */
export const localVideoGeneratorProblem = (env: Env): string | null => {
  if (env.LOCAL_VIDEO_GENERATOR !== 'vpipe') return null
  if (isLoopbackUrl(env.VPIPE_API_URL) || env.VPIPE_API_TOKEN !== undefined) return null
  return (
    'LOCAL_VIDEO_GENERATOR=vpipe で VPIPE_API_URL がこのマシンの外を指していますが、VPIPE_API_TOKEN がありません。' +
    'サーバと同じトークンを .env に設定するか、VPIPE_API_URL を http://127.0.0.1:8765 に戻して再起動してください。'
  )
}
