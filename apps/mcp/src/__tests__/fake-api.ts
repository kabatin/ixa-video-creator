import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createApiClient, type FetchLike } from '../api-client.js'
import type { FrameExtractor } from '../lib/frames.js'
import { createLogger } from '../logger.js'
import type { Clock, ToolDeps } from '../tool-def.js'

/**
 * 試験用の偽 API。決まった (method, path) に決まった応答を返し、来た要求を全部記録する。
 * 実 API・実ストレージには繋がない。
 */

export const TOKEN = 'secret-token-do-not-leak'
export const BASE = 'http://ixa.test'
export const WORKSPACE = '01J0000000000000000000WS00'

export type Route = {
  readonly method: string
  /** 完全一致（クエリを除く）か正規表現。 */
  readonly path: string | RegExp
  readonly status?: number
  /** 成功なら data。`raw` を付けると本文をそのまま返す。 */
  readonly data?: unknown
  readonly raw?: unknown
  readonly bytes?: Uint8Array
  /** 呼ばれるたびに違う応答を返したいとき。 */
  readonly sequence?: readonly Omit<Route, 'method' | 'path' | 'sequence'>[]
}

export type RecordedCall = {
  readonly method: string
  readonly url: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

const headersOf = (init: RequestInit | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))

const parseBody = (init: RequestInit | undefined): unknown => {
  if (typeof init?.body !== 'string') return init?.body === undefined ? undefined : '<binary>'
  return JSON.parse(init.body) as unknown
}

export type FakeApi = {
  readonly fetch: FetchLike
  readonly calls: RecordedCall[]
  readonly callsTo: (method: string, path: string | RegExp) => readonly RecordedCall[]
}

export const createFakeApi = (routes: readonly Route[]): FakeApi => {
  const calls: RecordedCall[] = []
  const counters = new Map<Route, number>()
  const fetch: FetchLike = (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url: input, path: url.pathname, headers: headersOf(init), body: parseBody(init) })
    const route = routes.find(
      (r) => r.method === method && (typeof r.path === 'string' ? r.path === url.pathname : r.path.test(url.pathname)),
    )
    if (route === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ success: false, error: `no fake route ${method} ${url.pathname}` }), { status: 404 }),
      )
    }
    const count = counters.get(route) ?? 0
    counters.set(route, count + 1)
    const step = route.sequence === undefined ? route : (route.sequence[Math.min(count, route.sequence.length - 1)] ?? route)
    const status = step.status ?? 200
    if (step.bytes !== undefined) return Promise.resolve(new Response(step.bytes, { status }))
    if (status === 204) return Promise.resolve(new Response(null, { status }))
    const body =
      step.raw !== undefined
        ? step.raw
        : status >= 400
          ? { success: false, error: typeof step.data === 'string' ? step.data : 'error' }
          : { success: true, data: step.data ?? null }
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  }
  return {
    fetch,
    calls,
    callsTo: (method, path) =>
      calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path))),
  }
}

export const fakeClock = (): Clock & { readonly slept: number[] } => {
  const state = { now: 0 }
  const slept: number[] = []
  return {
    slept,
    now: () => state.now,
    sleep: (ms) => {
      slept.push(ms)
      state.now += ms
      return Promise.resolve()
    },
  }
}

export const unusedFrames: FrameExtractor = {
  fromVideo: () => Promise.reject(new Error('not expected')),
  fromImage: () => Promise.reject(new Error('not expected')),
}

export const depsFor = (fake: FakeApi, overrides: Partial<ToolDeps> = {}): ToolDeps => ({
  api: createApiClient({ baseUrl: BASE, token: TOKEN, fetch: fake.fetch }),
  workspaceId: WORKSPACE,
  outputDir: '/tmp/ixa-mcp-test-out',
  logger: createLogger('silent'),
  frames: unusedFrames,
  clock: fakeClock(),
  ...overrides,
})

export const textOf = (result: CallToolResult): string => {
  const first = result.content[0]
  return first !== undefined && first.type === 'text' ? first.text : ''
}

export const jsonOf = (result: CallToolResult): unknown => {
  if (result.isError === true) throw new Error(`tool failed: ${textOf(result)}`)
  return JSON.parse(textOf(result)) as unknown
}

/** ULID っぽい ID を作る（26 文字・Crockford base32）。 */
export const ulid = (tag: string): string => `01J${tag.toUpperCase().padEnd(23, '0')}`.slice(0, 26)

/** Take の行（API の応答の形）。 */
export const takeRow = (id: string, parentTakeId: string | null, reason: string | null, shotId = ulid('SH1')) => ({
  id,
  shotId,
  index: 2,
  mediaAssetId: ulid('MD9'),
  spec: { durationSec: 5.125 },
  modelId: 'vpipe/minimax-h3-turbo',
  seedUsed: 7,
  costUsd: 0,
  parentTakeId,
  regenerationReason: reason,
  reviewStatus: 'pending',
  humanVerdict: 'unreviewed',
  createdAt: '2026-10-17T00:00:00Z',
})
