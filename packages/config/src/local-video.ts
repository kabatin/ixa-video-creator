import type { Env, LocalVideoGeneratorId } from './schema.js'

/**
 * 手元の生成サーバ（vpipe-api・wan-api）の設定の食い違いを起動時に止める（ADR-0031 / 0040）。
 *
 * どちらのサーバも、ループバック以外で待ち受けるならトークン無しでは起動しない。
 * だからこのマシンの外を指しているのにトークンが無い設定は、**必ず 401 で失敗する**。
 * それを生成を押すたびに（最初のフレームの画像を送りつけてから）知るのではなく、起動した時点で知らせる。
 *
 * **規則は 1 つにして、サーバごとの違いは下の表だけにする。** 片方にしか検査が無いと、
 * 同じ設定ミスが片方では起動時に止まり、もう片方では生成を押してから 401 で分かることになる。
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

/**
 * トークンの形。**サーバと同じ規則**（空白を含まない印字可能な ASCII を 32 文字以上）。
 * 短いトークンや、貼るときに紛れ込んだ空白・全角文字は、投入を押したときの 401 で初めて分かる。
 * それを起動の時点で止める。
 */
export const LOCAL_VIDEO_TOKEN_PATTERN = /^[\x21-\x7e]{32,}$/

type LocalVideoServerEnv = {
  readonly id: LocalVideoGeneratorId
  /** `.env` に書く名前。**値は文に入れない。** */
  readonly urlEnvName: 'VPIPE_API_URL' | 'WAN_API_URL'
  readonly tokenEnvName: 'VPIPE_API_TOKEN' | 'WAN_API_TOKEN'
  /** このマシンだけを指す既定。戻し方の案内に出す。 */
  readonly defaultUrl: string
}

/**
 * サーバごとの `.env` の名前。**ここが増えるだけで、検査の規則は増えない。**
 * 既定の URL はスキーマの既定値と同じ値を書く（`EnvSchema` の `VPIPE_API_URL` / `WAN_API_URL`）。
 *
 * **一覧ではなく `Record` で持つ。** サーバを足したときに書き忘れたら、配列なら黙って
 * 「検査されないサーバ」ができるが、`Record` なら型が落ちる。
 */
const LOCAL_VIDEO_SERVER_TABLE: Readonly<Record<LocalVideoGeneratorId, LocalVideoServerEnv>> =
  Object.freeze({
    vpipe: {
      id: 'vpipe',
      urlEnvName: 'VPIPE_API_URL',
      tokenEnvName: 'VPIPE_API_TOKEN',
      defaultUrl: 'http://127.0.0.1:8765',
    },
    wan: {
      id: 'wan',
      urlEnvName: 'WAN_API_URL',
      tokenEnvName: 'WAN_API_TOKEN',
      defaultUrl: 'http://127.0.0.1:8766',
    },
  })

export const LOCAL_VIDEO_SERVERS: readonly LocalVideoServerEnv[] = Object.freeze(
  Object.values(LOCAL_VIDEO_SERVER_TABLE),
)

/** 食い違いがあれば理由の文を返す。**値（URL やトークン）は文に入れない。** */
export const localVideoGeneratorProblem = (env: Env): string | null => {
  for (const server of LOCAL_VIDEO_SERVERS) {
    const token = env[server.tokenEnvName]
    if (token !== undefined && !LOCAL_VIDEO_TOKEN_PATTERN.test(token)) {
      return (
        `${server.tokenEnvName} の形が違います（空白を含まない半角の英数字・記号で 32 文字以上。サーバと同じ規則）。` +
        'サーバに設定したトークンをそのまま .env に貼り直すか、使わないなら空にして再起動してください。'
      )
    }
  }

  for (const server of LOCAL_VIDEO_SERVERS) {
    if (!env.LOCAL_VIDEO_GENERATOR.includes(server.id)) continue
    if (isLoopbackUrl(env[server.urlEnvName]) || env[server.tokenEnvName] !== undefined) continue
    return (
      `LOCAL_VIDEO_GENERATOR に ${server.id} があり ${server.urlEnvName} がこのマシンの外を指していますが、` +
      `${server.tokenEnvName} がありません。` +
      `サーバと同じトークンを .env に設定するか、${server.urlEnvName} を ${server.defaultUrl} に戻して再起動してください。`
    )
  }
  return null
}
