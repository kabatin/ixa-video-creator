import { createHash } from 'node:crypto'
import type { ObjectStorage, StorageKey } from '@ixa/storage'
import { assertPublicUrl, createDnsHostResolver, type HostResolver } from './ssrf.js'

/**
 * Provider が返す期限付き URL から実体を取り、ストレージへ格納する。
 * 期限付き URL は DB に保存しない（CLAUDE.md 規約 7 / ARCHITECTURE.md §11）。
 */

/** 既定のタイムアウト。長尺の生成物でも取り切れる程度に取る。 */
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

/** 既定のサイズ上限。超えたらストレージへ書かずに失敗させる。 */
export const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024

/** 追うリダイレクトの上限。 */
export const DEFAULT_MAX_REDIRECTS = 5

export type DownloadErrorCode =
  | 'blocked_address'
  | 'too_many_redirects'
  | 'http_error'
  | 'too_large'
  | 'timeout'
  | 'empty_body'
  | 'network_error'

export class DownloadError extends Error {
  override readonly name = 'DownloadError'
  constructor(
    readonly code: DownloadErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

export type DownloadedObject = {
  readonly storageKey: StorageKey
  readonly bytes: number
  readonly contentType: string
  readonly checksumSha256: string
}

export type DownloadOptions = {
  readonly url: string
  readonly storage: ObjectStorage
  readonly key: StorageKey
  readonly fallbackContentType?: string
  readonly maxBytes?: number
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  /** テストから差し替えるための注入点。既定は global fetch。 */
  readonly fetchImpl?: typeof fetch
  /** テストから差し替えるための注入点。既定は DNS 解決。 */
  readonly resolveHost?: HostResolver
}

const isRedirect = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308

/**
 * リダイレクトを 1 ホップずつ手で追う。
 * fetch の自動追従は使わない。**各ホップで宛先を検査する必要がある**ため
 * （1 ホップ目だけ検査しても内部 IP へ誘導される）。
 */
const fetchFollowing = async (
  start: string,
  options: Required<Pick<DownloadOptions, 'maxRedirects'>> & {
    fetchImpl: typeof fetch
    resolveHost: HostResolver
    signal: AbortSignal
  },
): Promise<Response> => {
  let current = await assertPublicUrl(start, options.resolveHost)

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const response = await options.fetchImpl(current, {
      redirect: 'manual',
      signal: options.signal,
    })

    if (!isRedirect(response.status)) return response

    const location = response.headers.get('location')
    if (location === null) {
      throw new DownloadError('http_error', `リダイレクト応答に Location がありません: ${response.status}`, false)
    }
    // 相対 Location にも対応する。解決後の絶対 URL を必ず検査する。
    current = await assertPublicUrl(new URL(location, current).toString(), options.resolveHost)
  }

  throw new DownloadError('too_many_redirects', `リダイレクトが ${options.maxRedirects} 回を超えました`, false)
}

/** 本文を読みながらサイズ上限を検査する。上限超過は読み切らずに打ち切る。 */
const readWithLimit = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    throw new DownloadError('too_large', `Content-Length ${declared} バイトが上限 ${maxBytes} を超えています`, false)
  }

  // Response.body の型は lib 構成によって緩くなるため、明示して any の伝播を止める。
  const body: ReadableStream<Uint8Array> | null = response.body
  if (body === null) throw new DownloadError('empty_body', '応答に本文がありません', true)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new DownloadError('too_large', `ダウンロードサイズが上限 ${maxBytes} バイトを超えました`, false)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/**
 * URL からダウンロードしてストレージへ格納する。
 * 失敗したらストレージには何も書かない（部分ファイルを残さない）。
 */
export const downloadToStorage = async (options: DownloadOptions): Promise<DownloadedObject> => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFollowing(options.url, {
      maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      fetchImpl: options.fetchImpl ?? fetch,
      resolveHost: options.resolveHost ?? createDnsHostResolver(),
      signal: controller.signal,
    })

    if (!response.ok) {
      // 5xx と 429 は時間を置けば通る可能性がある
      const retryable = response.status >= 500 || response.status === 429
      throw new DownloadError('http_error', `ダウンロードに失敗しました: HTTP ${response.status}`, retryable)
    }

    const body = await readWithLimit(response, maxBytes)
    const contentType =
      response.headers.get('content-type') ?? options.fallbackContentType ?? 'application/octet-stream'

    await options.storage.put(options.key, body, { contentType })

    return {
      storageKey: options.key,
      bytes: body.byteLength,
      contentType,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
    }
  } catch (error) {
    if (error instanceof DownloadError) throw error
    if (controller.signal.aborted) {
      throw new DownloadError('timeout', `ダウンロードが ${timeoutMs}ms でタイムアウトしました`, true, {
        cause: error,
      })
    }
    // BlockedAddressError もここを通る。文脈を付けて包み直す（CLAUDE.md 規約 5）。
    throw new DownloadError(
      error instanceof Error && error.name === 'BlockedAddressError' ? 'blocked_address' : 'network_error',
      `ダウンロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      false,
      { cause: error },
    )
  } finally {
    clearTimeout(timer)
  }
}
