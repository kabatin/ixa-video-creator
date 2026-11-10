import type { DemoFileRef } from '@ixa/domain'
import { DemoFileError } from './errors.js'

/**
 * リリースのファイルを https で取る（ADR-0067）。**リダイレクトは自分でたどる**（組み込みの fetch に任せると、
 * どこへ飛ばされても付いていく）。どの一歩も https で、許したホストだけ。断った先には要求を送らない。
 *
 * - 例外にもログにも**ファイル名だけ**を入れる（飛ばされた先は署名付きの URL）。元の例外も付けない（URL を含みうる）
 * - 目録より大きい応答は、大きさの申告でも、読んでいる途中でも断る
 * - 読んでいる途中で切れた・時間切れは「取りに行けなかった」（つながりの問題）
 */

/** 取りに行く先・飛ばされた先に許すホスト（GitHub のリリースのファイルと、その置き場）。 */
export const DEMO_FETCH_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

/** たどるリダイレクトの上限。 */
export const MAX_DEMO_REDIRECTS = 5

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/** 送ってよい先か（https で、許したホスト）。 */
const allowed = (url: URL): boolean => url.protocol === 'https:' && url.username === '' && url.password === '' && DEMO_FETCH_HOSTS.has(url.hostname)

const networkError = (entry: DemoFileRef, detail: string): DemoFileError => new DemoFileError('network', entry.file, detail)

const describeFailure = (error: unknown): string =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    ? '時間内に取れませんでした'
    : `つながりません（${error instanceof Error ? error.name : 'unknown'}）`

/** 1 歩ずつ送る。飛ばされたら次の先を確かめてから送る。 */
const follow = async (fetchImpl: typeof fetch, start: URL, entry: DemoFileRef, signal: AbortSignal): Promise<Response> => {
  let url = start
  for (let hop = 0; hop <= MAX_DEMO_REDIRECTS; hop += 1) {
    if (!allowed(url)) throw networkError(entry, hop === 0 ? '取りに行く先を許していません' : '許していない先へ飛ばされました')
    let response: Response
    try {
      response = await fetchImpl(url, { redirect: 'manual', signal })
    } catch (error) {
      throw networkError(entry, describeFailure(error))
    }
    if (!REDIRECT_STATUSES.has(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (location === null || !URL.canParse(location, url.href)) throw networkError(entry, '飛ばされた先が読めません')
    url = new URL(location, url)
  }
  throw networkError(entry, `飛ばされる回数が多すぎます（${String(MAX_DEMO_REDIRECTS)} 回まで）`)
}

/** 上限を超えたら止めて投げる読み方（応答の大きさの申告を信用しない）。途中で切れたらつながりの失敗にする。 */
const readCapped = async (body: ReadableStream<Uint8Array>, entry: DemoFileRef): Promise<Uint8Array> => {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>
    try {
      chunk = await reader.read()
    } catch (error) {
      throw networkError(entry, `読んでいる途中で切れました（${describeFailure(error)}）`)
    }
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > entry.sizeBytes) {
      await reader.cancel()
      throw new DemoFileError('broken', entry.file, '目録より大きい応答です')
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks)
}

/** 取りに行き、本文を丸ごと返す（大きさと sha256 は呼ぶ側が確かめる）。 */
export const fetchReleaseFile = async (
  fetchImpl: typeof fetch,
  baseUrl: string,
  entry: DemoFileRef,
  timeoutMs: number,
): Promise<Uint8Array> => {
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await follow(fetchImpl, new URL(entry.file, baseUrl), entry, signal)
  if (!response.ok || response.body === null) {
    await response.body?.cancel()
    throw networkError(entry, `応答 ${String(response.status)}`)
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > entry.sizeBytes) {
    await response.body.cancel()
    throw new DemoFileError('broken', entry.file, '目録より大きい応答です')
  }
  return readCapped(response.body, entry)
}
