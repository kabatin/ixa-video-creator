/**
 * 公開する見本の目録の点検（ADR-0067「公開する目録に入れないもの」）。純粋。
 * 鍵・署名付きの URL と、作る人の機械と持ち主の情報を含む値の**場所だけ**を返す。
 */

/**
 * 署名・鍵を運ぶ問い合わせの名前（fs の `sig`・`exp`、S3 の `X-Amz-*`、GCS の `X-Goog-*`、CloudFront の
 * `Key-Pair-Id`・`Policy`、API の鍵の `key`・`api_key`、そのほかの `token` など）。
 */
const SIGNED_QUERY_NAMES =
  /[?&](sig|signature|exp|expires|token|access_token|key|api_key|apikey|policy|key-pair-id|x-amz-[a-z-]+|x-goog-[a-z-]+)=/i

/** 署名付きの URL に見える文字か（書き出す目録に入れない）。URL の形で、署名・鍵の問い合わせを持つもの。 */
export const looksLikeSignedUrl = (text: string): boolean => /[a-z]+:\/\//i.test(text) && SIGNED_QUERY_NAMES.test(text)

/**
 * 公開する目録に入れてはいけないものを探す決まり（ADR-0067「公開する目録に入れないもの」）。
 * 機械と持ち主の情報（ホーム・利用者名・手元の道・手元のサーバ）と、秘密（鍵・署名付きの URL）。
 * ホームと利用者名は呼ぶ側が渡す（ここは純粋なまま）。
 */
export type PublicLeakRules = {
  /** 置き場の署名の鍵・S3 の鍵・合言葉など。空の文字は見ない。 */
  readonly secrets: readonly string[]
  /** 作る人のホーム（`os.homedir()`）。空なら見ない。 */
  readonly homeDir: string
  /** 作る人の利用者名（`os.userInfo().username`）。短すぎる名前は見ない（どの文にも当たる）。 */
  readonly userName: string
}

/** 利用者名として見る最短の長さ。 */
const MIN_USER_NAME_LENGTH = 3

/** 手元の道（文の頭か区切りの後ろから始まるもの）。URL の中の `/home/` などは当てない。 */
const LOCAL_PATH = /(?:^|[\s"'=(<,;])(?:\/(?:Users|home|private|tmp)\/|\/var\/folders\/|[A-Za-z]:[\\/])/
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi

/** 手元のサーバ（この Mac・LAN の中）を指す名前か。 */
const isLocalHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0') return true
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a = -1, b = -1] = octets
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/** URL の中の手元のサーバ（この Mac・LAN）か、利用者名・パスワード（`user:pw@`）。 */
const leakyUrl = (text: string): boolean =>
  [...text.matchAll(URL_IN_TEXT)].some(([url]) => {
    if (!URL.canParse(url)) return false
    const parsed = new URL(url)
    return isLocalHost(parsed.hostname) || parsed.username !== '' || parsed.password !== ''
  })

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/

/** `%2F` などを戻した文字（戻せなければそのまま）。**戻した方と戻す前の両方を見る。** */
const percentDecoded = (text: string): string => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

const leaksAsIs = (text: string, rules: PublicLeakRules): boolean =>
  looksLikeSignedUrl(text) ||
  EMAIL.test(text) ||
  rules.secrets.some((secret) => secret !== '' && text.includes(secret)) ||
  (rules.homeDir !== '' && text.includes(rules.homeDir)) ||
  (rules.userName.length >= MIN_USER_NAME_LENGTH && text.includes(rules.userName)) ||
  LOCAL_PATH.test(text) ||
  /file:\/\//i.test(text) ||
  leakyUrl(text)

/** 1 つの文字が決まりに当たるか（`%` で書いた文字も戻して見る）。 */
const leaks = (raw: string, rules: PublicLeakRules): boolean => [raw, percentDecoded(raw)].some((text) => leaksAsIs(text, rules))

const childPath = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)

/**
 * 決まりに当たる文字（値とキー）の**場所だけ**を返す（例 `source.shots[0].description`）。
 * 値は返さない（秘密を端末やログに写さない）。
 */
export const publicLeaks = (value: unknown, rules: PublicLeakRules, path = ''): readonly string[] => {
  if (typeof value === 'string') return leaks(value, rules) ? [path] : []
  if (Array.isArray(value)) return value.flatMap((item: unknown, index) => publicLeaks(item, rules, `${path}[${String(index)}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => {
      const here = childPath(path, key)
      return [...(leaks(key, rules) ? [here] : []), ...publicLeaks(item, rules, here)]
    })
  }
  return []
}
