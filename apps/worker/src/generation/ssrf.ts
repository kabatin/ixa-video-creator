import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * 外部 URL からのダウンロードで内部ネットワークへ誘導されるのを防ぐ（SSRF 対策）。
 * Provider が返す期限付き URL も、そこからのリダイレクトも外部入力として扱う。
 */

export class BlockedAddressError extends Error {
  override readonly name = 'BlockedAddressError'
  constructor(readonly target: string, readonly reason: string) {
    super(`このアドレスへの接続は許可されていません: ${target}（${reason}）`)
  }
}

/** ホスト名 → IP アドレス一覧。テストでは偽の解決器を注入する。 */
export type HostResolver = (hostname: string) => Promise<readonly string[]>

export const createDnsHostResolver = (): HostResolver => async (hostname) => {
  const records = await lookup(hostname, { all: true })
  return records.map((r) => r.address)
}

/** 明らかに内部を指すホスト名。DNS を引くまでもなく拒否する。 */
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'] as const
const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'] as const

const octets = (ip: string): number[] | null => {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const values = parts.map((p) => Number(p))
  return values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ? values : null
}

const isPrivateIpv4 = (ip: string): boolean => {
  const parsed = octets(ip)
  if (parsed === null) return true // 解釈できないものは通さない
  const [a = 0, b = 0] = parsed
  if (a === 0 || a === 127) return true // 未指定 / ループバック
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // リンクローカル（クラウドのメタデータ）
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 0) return true // 192.0.0.0/24 / 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true // ベンチマーク用
  if (a >= 224) return true // マルチキャスト / 予約
  return false
}

const isPrivateIpv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase().split('%')[0] ?? ''
  if (normalized === '::1' || normalized === '::') return true

  // IPv4 射影アドレス（::ffff:127.0.0.1 など）は IPv4 として判定する
  const mapped = /^::ffff:(.+)$/.exec(normalized)
  if (mapped?.[1] !== undefined && isIP(mapped[1]) === 4) return isPrivateIpv4(mapped[1])

  const head = normalized.split(':')[0] ?? ''
  if (head.startsWith('fc') || head.startsWith('fd')) return true // ユニークローカル
  if (/^fe[89ab]/.test(head)) return true // リンクローカル
  return false
}

/** ループバック・プライベート・リンクローカルなど、外部へ出ないアドレスか。 */
export const isPrivateAddress = (ip: string): boolean => {
  const version = isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  return true // IP として解釈できないものは通さない
}

/**
 * URL が外部の公開アドレスを指していることを確かめる。
 * リダイレクトを追うたびに毎回呼ぶこと。1 ホップ目だけ検査しても意味がない。
 */
export const assertPublicUrl = async (raw: string, resolve: HostResolver): Promise<URL> => {
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw new BlockedAddressError(raw, `URL として解釈できません: ${String(error)}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedAddressError(raw, `対応しないスキームです: ${url.protocol}`)
  }

  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (hostname.length === 0) throw new BlockedAddressError(raw, 'ホスト名がありません')
  if (BLOCKED_HOSTNAMES.includes(hostname as (typeof BLOCKED_HOSTNAMES)[number])) {
    throw new BlockedAddressError(raw, '内部を指すホスト名です')
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new BlockedAddressError(raw, '内部を指すホスト名です')
  }

  const addresses = isIP(hostname) !== 0 ? [hostname] : await resolve(hostname)
  if (addresses.length === 0) {
    throw new BlockedAddressError(raw, 'ホスト名を解決できませんでした')
  }
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedAddressError(raw, `内部 IP へ解決されました: ${address}`)
    }
  }

  return url
}
