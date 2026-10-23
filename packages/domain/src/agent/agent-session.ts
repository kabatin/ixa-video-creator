import { z } from 'zod'
import { AgentSessionId, ProjectId, ShotId } from '../common/ids.js'
import { AgentApprovalDecision } from './agent-message.js'

/**
 * AI エージェントの会話（タスク）（ADR-0058。制作者の要望 2026-10-23）。
 * ixa の MCP でできる操作を、画面の中からチャットで頼む。会話は作品ごとに残り、続きから話せる。
 */

/**
 * 使う Claude のモデル。**モデル ID で書く**（`claude-sonnet-5-5`）。別名（`sonnet`）は設定によって
 * 別のモデルに向くので受けない（`IMAGE_CHECK_MODEL` と同じ教訓）。CLI の引数に渡すので、英数字と `.` `-` `_` だけ。
 */
export const AgentModel = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^claude-[A-Za-z0-9._-]+$/, 'モデル ID（claude- で始まる）で書いてください')
export type AgentModel = z.infer<typeof AgentModel>

/**
 * - `idle`: 待っている（話しかければ動く。画面では「済み」）
 * - `running`: 作業中
 * - `awaiting_approval`: 制作者の確認を待っている
 * - `interrupted`: 止めた・API が落ちて途切れた（続きから話せる）
 * - `error`: CLI が失敗した（続きから話せる）
 */
export const AgentSessionStatus = z.enum(['idle', 'running', 'awaiting_approval', 'interrupted', 'error'])
export type AgentSessionStatus = z.infer<typeof AgentSessionStatus>

export const AGENT_SESSION_TITLE_MAX = 80

export const AgentSession = z.object({
  id: AgentSessionId,
  projectId: ProjectId,
  /** 最初の依頼から自動で付く。後で直せる。 */
  title: z.string().trim().min(1).max(AGENT_SESSION_TITLE_MAX),
  model: AgentModel,
  /** CLI の会話 ID（`--resume` に渡す）。最初のやりとりが始まるまでは null。 */
  cliSessionId: z.string().min(1).nullable(),
  status: AgentSessionStatus,
  /** 「確認なしでいい」と言われた（このタスクの中だけ）。制作者はいつでも戻せる。 */
  confirmationsWaived: z.boolean(),
  costUsd: z.number().min(0),
  /** 読むだけ以外の操作をした数。 */
  editCount: z.number().int().min(0),
  /** 最後の返事の 1 行目（一覧のカードに出す）。 */
  lastSummary: z.string().nullable(),
  createdAt: z.date(),
  lastActiveAt: z.date(),
})
export type AgentSession = z.infer<typeof AgentSession>

const TRANSITIONS: Readonly<Record<AgentSessionStatus, readonly AgentSessionStatus[]>> = {
  idle: ['running'],
  running: ['idle', 'awaiting_approval', 'interrupted', 'error'],
  awaiting_approval: ['running', 'interrupted', 'error'],
  interrupted: ['running'],
  error: ['running'],
}

/** 決めた遷移か。止める（→ interrupted）は作業中か確認待ちのときだけ。 */
export const canTransitionAgentSession = (from: AgentSessionStatus, to: AgentSessionStatus): boolean =>
  TRANSITIONS[from].includes(to)

/** 作業中として扱う状態（同じ作品で同時に動けるのは 1 つだけ）。 */
export const isAgentSessionBusy = (status: AgentSessionStatus): boolean =>
  status === 'running' || status === 'awaiting_approval'

const TITLE_FROM_MESSAGE_MAX = 40
/** 最初の依頼が来るまでの題名。最初の依頼で付け替える（制作者が付けた題名は替えない）。 */
export const AGENT_SESSION_UNTITLED = '新しいタスク'

/** 最初の依頼から題名を作る。1 行目を、空白の並びを 1 つにして 40 文字まで。 */
export const sessionTitleFrom = (firstMessage: string): string => {
  const firstLine =
    firstMessage
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .find((line) => line !== '') ?? ''
  if (firstLine === '') return AGENT_SESSION_UNTITLED
  const chars = Array.from(firstLine)
  return chars.length > TITLE_FROM_MESSAGE_MAX ? `${chars.slice(0, TITLE_FROM_MESSAGE_MAX).join('')}…` : firstLine
}

const SUMMARY_MAX = 120

/** 返事から一覧のカードに出す 1 行を作る。最初の行を、見出し・箇条書き・太字の飾りを外して 120 文字まで。 */
export const summaryLineFrom = (text: string): string | null => {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s+)/, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim())
    .find((l) => l !== '')
  if (line === undefined) return null
  const chars = Array.from(line)
  return chars.length > SUMMARY_MAX ? `${chars.slice(0, SUMMARY_MAX).join('')}…` : line
}

/** 一覧の並び。確認待ちと作業中を上に寄せ、残りは最後に話した順（新しい順）。元の配列は変えない。 */
export const sortAgentSessionsForList = <T extends Pick<AgentSession, 'status' | 'lastActiveAt'>>(
  sessions: readonly T[],
): readonly T[] =>
  [...sessions].sort((a, b) => {
    const busy = Number(isAgentSessionBusy(b.status)) - Number(isAgentSessionBusy(a.status))
    if (busy !== 0) return busy
    return b.lastActiveAt.getTime() - a.lastActiveAt.getTime()
  })

/** 一覧の絞り込み。題名か最後の返事の要約に含むもの（大文字小文字を区別しない）。 */
export const filterAgentSessions = <T extends Pick<AgentSession, 'title' | 'lastSummary'>>(
  sessions: readonly T[],
  query: string,
): readonly T[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return sessions
  return sessions.filter((s) => `${s.title}\n${s.lastSummary ?? ''}`.toLowerCase().includes(needle))
}

export const AGENT_MESSAGE_TEXT_MAX = 4000

/** 新しいタスク。モデルを省けば設定の既定（`AGENT_MODEL_DEFAULT`）。 */
export const CreateAgentSessionInput = z.object({ model: AgentModel.optional() }).strict()
export type CreateAgentSessionInput = z.infer<typeof CreateAgentSessionInput>

/** 題名・モデル・確認なしの旗を直す。どれか 1 つは要る。 */
export const UpdateAgentSessionInput = z
  .object({
    title: z.string().trim().min(1).max(AGENT_SESSION_TITLE_MAX).optional(),
    model: AgentModel.optional(),
    confirmationsWaived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.model !== undefined || v.confirmationsWaived !== undefined, {
    message: '題名・モデル・確認なしのどれかを指定してください',
  })
export type UpdateAgentSessionInput = z.infer<typeof UpdateAgentSessionInput>

/** 話す。文脈（選んでいる Shot・再生位置）は画面が毎回添える。 */
export const SendAgentMessageInput = z
  .object({
    text: z.string().trim().min(1).max(AGENT_MESSAGE_TEXT_MAX),
    context: z
      .object({
        shotId: ShotId.nullable().optional(),
        playheadSec: z.number().min(0).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type SendAgentMessageInput = z.infer<typeof SendAgentMessageInput>

/** 確認のカードの答え。「以後このタスクでは確認しない」は実行のときだけ付けられる。 */
export const AgentApprovalAnswer = z
  .object({ decision: AgentApprovalDecision, waiveAfter: z.boolean().default(false) })
  .strict()
  .refine((v) => v.decision === 'allow' || !v.waiveAfter, { message: 'やめるときは「以後確認しない」を付けられません' })
export type AgentApprovalAnswer = z.infer<typeof AgentApprovalAnswer>
