import { IXA_MCP_TOOL_PREFIX, type AgentMessageContext, type AgentSessionStatus, type ToolRisk } from '@ixa/domain'
import type { WireAgentMessage } from '@/lib/agent-api'
import { AGENT_TOOL_LABELS } from '@/lib/agent-tool-labels'

export { AGENT_TOOL_LABELS } from '@/lib/agent-tool-labels'

/**
 * AI エージェントの会話の行を、画面に出す形にする（ADR-0058）。**React を含まない。**
 *
 * - ツールの呼び出しと結果は 1 行にまとめる（作っている → 済み・失敗）
 * - 確認のカードは、答えるまで「待っている」
 * - CLI の始まり・知らない行・やりとりの終わりは出さない（記録には残っている）
 * - **内部 ID と URL は出さない**（`scrubInternal`）
 */

export const AGENT_STATUS_LABELS: Readonly<Record<AgentSessionStatus, string>> = Object.freeze({
  running: '作業中',
  awaiting_approval: '確認待ち',
  idle: '済み',
  interrupted: '中断',
  error: '中断',
})

export type AgentToolState = 'running' | 'done' | 'failed'

export type AgentItem =
  | { readonly kind: 'user'; readonly seq: number; readonly text: string; readonly context: AgentMessageContext | null }
  | { readonly kind: 'assistant'; readonly seq: number; readonly text: string }
  | {
      readonly kind: 'tool'
      readonly seq: number
      readonly toolUseId: string
      readonly state: AgentToolState
      readonly title: string
      readonly startedAt: string
      /** 頼んだ内容（内部 ID を外した `欄: 値`）。 */
      readonly request: readonly string[]
      /** 結果の要約。まだなら null。 */
      readonly result: string | null
    }
  | {
      readonly kind: 'approval'
      readonly seq: number
      readonly requestId: string
      readonly risk: ToolRisk
      readonly title: string
      /** `expired` は、答える前にやりとりが終わった（止めた・API の再起動）。もう押せない。 */
      readonly state: 'pending' | 'allowed' | 'denied' | 'expired'
    }
  | { readonly kind: 'notice'; readonly seq: number; readonly tone: 'info' | 'warn' | 'danger'; readonly text: string }

/** 通し番号の順に並べ、同じ番号は 1 つにする。元の配列は変えない。 */
export const mergeAgentMessages = (
  current: readonly WireAgentMessage[],
  incoming: readonly WireAgentMessage[],
): readonly WireAgentMessage[] => {
  const bySeq = new Map([...current, ...incoming].map((message) => [message.seq, message]))
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

const ULID_PATTERN = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g
const URL_PATTERN = /\bhttps?:\/\/\S+/g
const SCRUB_MAX = 300

/** 内部 ID（ULID）と URL を伏せ、長い文は切る。 */
export const scrubInternal = (text: string): string => {
  const scrubbed = text.replace(URL_PATTERN, '…').replace(ULID_PATTERN, '…')
  const chars = Array.from(scrubbed)
  return chars.length > SCRUB_MAX ? `${chars.slice(0, SCRUB_MAX).join('')}…` : scrubbed
}

const bareName = (toolName: string): string =>
  toolName.startsWith(IXA_MCP_TOOL_PREFIX) ? toolName.slice(IXA_MCP_TOOL_PREFIX.length) : toolName

const UNKNOWN_LABEL = { doing: '操作している', done: '操作した', ask: '操作を実行します' } as const

/** ツールの言い方（数を入れる）。知らないツールは名前を出さず「操作」と言う。 */
export const toolLabel = (toolName: string, input: unknown): { doing: string; done: string; ask: string } => {
  const spec = AGENT_TOOL_LABELS[bareName(toolName)]
  if (spec === undefined) return { ...UNKNOWN_LABEL }
  const field = spec.count === undefined || typeof input !== 'object' || input === null ? undefined : (input as Record<string, unknown>)[spec.count.field]
  const count = Array.isArray(field) && spec.count !== undefined ? ` ${String(field.length)} ${spec.count.unit}` : ''
  const fill = (text: string): string => text.replace('{n}', count)
  return { doing: fill(spec.doing), done: fill(spec.done), ask: fill(spec.ask ?? `「${spec.done}」を実行します`) }
}

const isInternalKey = (key: string): boolean => /Ids?$/.test(key) || key === 'id'

/** 頼んだ内容を `欄: 値` の行にする（内部 ID の欄は外す）。 */
const requestLines = (input: unknown): readonly string[] => {
  if (typeof input !== 'object' || input === null) return []
  return Object.entries(input as Record<string, unknown>)
    .filter(([key]) => !isInternalKey(key))
    .map(([key, value]) => `${key}: ${scrubInternal(typeof value === 'string' ? value : JSON.stringify(value))}`)
}

const NOTICE_TONES = {
  confirmations_waived: 'info',
  confirmations_restored: 'info',
  interrupted: 'warn',
  failed: 'danger',
} as const

type Pending = { readonly tools: ReadonlyMap<string, number> }

/**
 * やりとりが終わった（終わりの行・止めた・失敗・次の依頼）。答えていない確認はもう押せず、
 * 結果の来ていない操作は「途中で止まった」にする。
 */
const closeTurn = (items: readonly AgentItem[]): readonly AgentItem[] =>
  items.map((item) => {
    if (item.kind === 'approval' && item.state === 'pending') return { ...item, state: 'expired' }
    if (item.kind === 'tool' && item.state === 'running') {
      return { ...item, state: 'failed', title: `${item.title.replace(/ている$/, 'ていた')}が、途中で止まった` }
    }
    return item
  })

/** 会話の行（通し番号の順）を、画面の項目にする。 */
export const agentItemsFrom = (messages: readonly WireAgentMessage[]): readonly AgentItem[] =>
  messages.reduce<{ readonly items: readonly AgentItem[]; readonly pending: Pending }>(
    ({ items, pending }, message) => {
      const body = message.body
      const add = (item: AgentItem) => ({ items: [...items, item], pending })
      switch (body.kind) {
        case 'user':
          return {
            items: [...closeTurn(items), { kind: 'user', seq: message.seq, text: body.text, context: body.context }],
            pending,
          }
        case 'assistant_text':
          return body.text.trim() === '' ? { items, pending } : add({ kind: 'assistant', seq: message.seq, text: body.text })
        case 'tool_call': {
          if (bareName(body.toolName) === 'approve') return { items, pending }
          const item: AgentItem = {
            kind: 'tool',
            seq: message.seq,
            toolUseId: body.toolUseId,
            state: 'running',
            title: toolLabel(body.toolName, body.input).doing,
            startedAt: message.createdAt,
            request: requestLines(body.input),
            result: null,
          }
          return { items: [...items, item], pending: { tools: new Map([...pending.tools, [body.toolUseId, items.length]]) } }
        }
        case 'tool_result': {
          const index = pending.tools.get(body.toolUseId)
          const target = index === undefined ? undefined : items[index]
          if (target?.kind !== 'tool') return { items, pending }
          const calls = messages.find((m) => m.body.kind === 'tool_call' && m.body.toolUseId === body.toolUseId)?.body
          const label = calls?.kind === 'tool_call' ? toolLabel(calls.toolName, calls.input) : UNKNOWN_LABEL
          const updated: AgentItem = {
            ...target,
            state: body.isError ? 'failed' : 'done',
            title: body.isError ? `${label.doing.replace(/ている$/, 'ていた')}が、うまくいかなかった` : label.done,
            result: scrubInternal(body.text),
          }
          return { items: items.map((item, i) => (i === index ? updated : item)), pending }
        }
        case 'approval_request':
          return add({
            kind: 'approval',
            seq: message.seq,
            requestId: body.requestId,
            risk: body.risk,
            title: toolLabel(body.toolName, body.input).ask,
            state: 'pending',
          })
        case 'approval_decision':
          return {
            items: items.map((item) =>
              item.kind === 'approval' && item.requestId === body.requestId
                ? { ...item, state: body.decision === 'allow' ? 'allowed' : 'denied' }
                : item,
            ),
            pending,
          }
        case 'system': {
          const ended = body.event === 'interrupted' || body.event === 'failed' ? closeTurn(items) : items
          if (!(body.event in NOTICE_TONES) || body.text === null) return { items: ended, pending }
          const tone = NOTICE_TONES[body.event as keyof typeof NOTICE_TONES]
          return { items: [...ended, { kind: 'notice', seq: message.seq, tone, text: body.text }], pending }
        }
        case 'turn_end':
          return { items: closeTurn(items), pending }
      }
    },
    { items: [], pending: { tools: new Map() } },
  ).items
