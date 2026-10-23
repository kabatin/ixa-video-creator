import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolRisk } from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, IxaUnreachableError, type ApiClient } from './api-client.js'
import type { FrameExtractor } from './lib/frames.js'
import type { Logger } from './logger.js'

/**
 * ツールの定義。登録（server.ts）と試験が同じ定義を読む。
 *
 * `run` は**生の引数**を受け、`input` で検証してから中身を呼ぶ。MCP の SDK も検証するが、
 * 試験から直接呼んだときにも同じ制約が効くよう、ここでもう一度通す。
 */

export type ToolDeps = {
  readonly api: ApiClient
  readonly workspaceId: string
  readonly outputDir: string
  readonly logger: Logger
  readonly frames: FrameExtractor
  /** 待つ処理の時計。試験では差し替える。 */
  readonly clock: Clock
  /**
   * 呼び出しごとの途中経過の通知（クライアントが progressToken を付けたときだけ届く）。
   * 待つツールが使う。
   */
  readonly progress?: (done: number, total: number, message: string) => Promise<void>
  /**
   * AI エージェントの会話の中で起こされたときの会話（ADR-0058。env の `IXA_AGENT_SESSION_ID`）。
   * あるときだけ、会話の中で使うツール（approve・waive_confirmations）を登録する。
   */
  readonly agentSessionId?: string
}

export type Clock = {
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export type ToolDef = {
  readonly name: string
  /**
   * 危険度（ADR-0058）。AI エージェントのタブは、これで実行の前に制作者に確認するかを決める。
   * MCP の annotations（readOnlyHint・destructiveHint）にも写す。**省けない**（付け忘れは型エラー）。
   */
  readonly risk: ToolRisk
  /**
   * この呼び出しの危険度。action で重さが変わるツール（edit_character の update と delete など）は入力から決め、
   * ふつうの直しのたびに確認が出ないようにする。`risk` は「いちばん重い印」のまま。
   * 入力が読めないとき・ツールが決め方を持たないときは `risk` に倒す。
   */
  readonly riskOf: (rawArgs: unknown) => ToolRisk
  readonly description: string
  readonly input: z.AnyZodObject
  readonly run: (rawArgs: unknown, deps: ToolDeps) => Promise<CallToolResult>
}

/** 利用者（エージェント）の入力の誤り。API に送る前に断る。 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

export const defineTool = <S extends z.ZodRawShape>(def: {
  readonly name: string
  readonly risk: ToolRisk
  /** action で危険度が変わるときだけ書く。`risk` より重くしない。 */
  readonly riskOf?: (args: z.infer<z.ZodObject<S>>) => ToolRisk
  readonly description: string
  readonly input: z.ZodObject<S>
  readonly handler: (args: z.infer<z.ZodObject<S>>, deps: ToolDeps) => Promise<CallToolResult>
}): ToolDef => ({
  name: def.name,
  risk: def.risk,
  riskOf: (rawArgs) => {
    const riskOf = def.riskOf
    if (riskOf === undefined) return def.risk
    const parsed = def.input.safeParse(rawArgs ?? {})
    return parsed.success ? riskOf(parsed.data) : def.risk
  },
  description: def.description,
  input: def.input,
  run: async (rawArgs, deps) => {
    const parsed = def.input.safeParse(rawArgs ?? {})
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      return errorResult(`入力が不正です — ${issues.join(' / ')}`)
    }
    try {
      return await def.handler(parsed.data, deps)
    } catch (error) {
      // 例外そのものを渡す（cause の連なりを残す。鍵と URL は logger 側で伏せる）。
      deps.logger.warn({ tool: def.name, err: error }, 'ツールが失敗しました')
      return errorResult(describeError(error))
    }
  },
})

/** データの結果は短い JSON にする（エージェントの文脈を食わないよう、整形しない）。 */
export const jsonResult = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
})

export const errorResult = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
})

/**
 * 失敗を、エージェントが次の手を決められる文にする。API の文（日本語）と状態コードはそのまま渡す。
 * 鍵は例外のどこにも入っていない（api-client が載せない）。
 */
export const describeError = (error: unknown): string => {
  if (error instanceof IxaApiError) {
    const fields =
      error.fields === null
        ? ''
        : ` ${Object.entries(error.fields)
            .map(([field, messages]) => `${field}: ${messages.join('、')}`)
            .join(' / ')}`
    return `ixa API ${String(error.status)} (${error.method} ${error.path}): ${error.apiMessage}${fields}`
  }
  if (error instanceof IxaUnreachableError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/** seed の上限（API の曲の口と同じ 32bit 符号つきの最大）。 */
export const SEED_MAX = 2 ** 31 - 1

/** ULID（ixa の ID はすべて ULID）。 */
export const Id = z.string().ulid()

/** `limit` 件ずつ並べて投げる。API を詰まらせないため。結果は入力の順。 */
export const mapLimited = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<readonly R[]> => {
  const size = Math.max(1, limit)
  const chunks = Array.from({ length: Math.ceil(items.length / size) }, (_unused, i) =>
    items.slice(i * size, (i + 1) * size),
  )
  return chunks.reduce<Promise<readonly R[]>>(
    async (done, chunk, chunkIndex) => [
      ...(await done),
      ...(await Promise.all(chunk.map((item, j) => fn(item, chunkIndex * size + j)))),
    ],
    Promise.resolve([]),
  )
}

/** 小数の秒を読みやすく丸める（結果を短くする）。 */
export const round = (value: number, digits = 3): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
