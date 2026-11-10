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
 * ホーム・利用者名・作る人が渡した語は呼ぶ側が渡す（ここは純粋なまま）。
 */
export type PublicLeakRules = {
  /** 置き場の署名の鍵・S3 の鍵・合言葉など。空の文字は見ない。 */
  readonly secrets: readonly string[]
  /** 作る人のホーム（`os.homedir()`）。空なら見ない。 */
  readonly homeDir: string
  /** 作る人の利用者名（`os.userInfo().username`）。大文字小文字を区別しない。短すぎる名前は見ない（どの文にも当たる）。 */
  readonly userName: string
  /** 作る人が渡した、拾ってほしい語（本名・ハンドル名・機械の名前）。大文字小文字を区別しない。短すぎる語は見ない。 */
  readonly extraWords?: readonly string[]
}

/** 利用者名・渡した語として見る最短の長さ。 */
export const MIN_LEAK_WORD_LENGTH = 3

/**
 * 手元の道（文の頭か区切りの後ろから始まるもの。大文字小文字を区別しない）。URL の中の `/home/` などは当てない。
 * `~/`（ホームの下）と Windows のドライブも。
 */
const LOCAL_PATH = /(?:^|[\s"'=(<,;])(?:\/(?:users|home|private|tmp)\/|\/var\/folders\/|~\/|[a-z]:[\\/])/i
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi
/** スキームの無い IPv4（ポート付きも）。前後が数字やドットの続きなら当てない（版番号などの一部にしない）。 */
const IPV4_IN_TEXT = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d]|\.\d)/g

/** LAN・この機械・VPN の中だけで通じる名前の終わり。 */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.lan', '.internal', '.home.arpa', '.ts.net'] as const

/** この機械・LAN・共有アドレス空間（100.64.0.0/10）・リンクローカルの IPv4 か。 */
const isPrivateIpv4 = (octets: readonly number[]): boolean => {
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a = -1, b = -1] = octets
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** この機械・LAN の中だけの IPv6（`::1`・`fc00::/7`・`fe80::/10`）か。 */
const isPrivateIpv6 = (host: string): boolean => {
  if (!host.includes(':')) return false
  if (host === '::1') return true
  const first = Number.parseInt(host.split(':')[0] ?? '', 16)
  return Number.isFinite(first) && ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80)
}

/** 手元のサーバ（この Mac・LAN・VPN の中）を指す名前か。ドットの無い名前（`intranet` など）も。 */
const isLocalHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (isPrivateIpv6(host)) return true
  if (host === 'localhost' || !host.includes('.') || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  return isPrivateIpv4(host.split('.').map(Number))
}

/** URL が平文の http か、手元のサーバか、利用者名やパスワード（`user:pw@`）を持つか。 */
const leakyUrl = (text: string): boolean =>
  [...text.matchAll(URL_IN_TEXT)].some(([url]) => {
    if (/^http:\/\//i.test(url)) return true
    if (!URL.canParse(url)) return false
    const parsed = new URL(url)
    return isLocalHost(parsed.hostname) || parsed.username !== '' || parsed.password !== ''
  })

/** スキームの無い私用の IPv4（`192.168.0.12`・`10.1.2.3:8787`）。 */
const hasPrivateIpv4 = (text: string): boolean =>
  [...text.matchAll(IPV4_IN_TEXT)].some((match) => isPrivateIpv4(match.slice(1, 5).map(Number)))

/** 大文字小文字を区別せず含むか（短すぎる語は見ない）。 */
const containsWord = (text: string, word: string): boolean =>
  word.trim().length >= MIN_LEAK_WORD_LENGTH && text.toLowerCase().includes(word.trim().toLowerCase())

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
  (rules.homeDir !== '' && text.toLowerCase().includes(rules.homeDir.toLowerCase())) ||
  containsWord(text, rules.userName) ||
  (rules.extraWords ?? []).some((word) => containsWord(text, word)) ||
  LOCAL_PATH.test(text) ||
  /file:\/\//i.test(text) ||
  leakyUrl(text) ||
  hasPrivateIpv4(text)

/** 1 つの文字が決まりに当たるか（`%` で書いた文字も戻して見る）。 */
const leaks = (raw: string, rules: PublicLeakRules): boolean => [raw, percentDecoded(raw)].some((text) => leaksAsIs(text, rules))

const childPath = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)

/** 決まりに当たったキーを、場所の中で伏せる印。 */
const MASKED_KEY = '<key>'

/**
 * 決まりに当たる文字（値とキー）の**場所だけ**を返す（例 `source.shots[0].description`）。
 * 値は返さない。当たったキーは場所の中でも `<key>` に伏せる（その下の場所も）。秘密を端末やログに写さない。
 */
export const publicLeaks = (value: unknown, rules: PublicLeakRules, path = ''): readonly string[] => {
  if (typeof value === 'string') return leaks(value, rules) ? [path] : []
  if (Array.isArray(value)) return value.flatMap((item: unknown, index) => publicLeaks(item, rules, `${path}[${String(index)}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => {
      const keyLeaks = leaks(key, rules)
      const here = childPath(path, keyLeaks ? MASKED_KEY : key)
      return [...(keyLeaks ? [here] : []), ...publicLeaks(item, rules, here)]
    })
  }
  return []
}
