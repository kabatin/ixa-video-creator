import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import {
  AgentMessage as AgentMessageSchema,
  AgentMessageBody as AgentMessageBodySchema,
  AgentSession as AgentSessionSchema,
  AgentSessionId as AgentSessionIdSchema,
  AgentSessionStatus as AgentSessionStatusSchema,
  canTransitionAgentSession,
  newId,
  type AgentMessage,
  type AgentMessageBody,
  type AgentSession,
  type AgentSessionId,
  type AgentSessionStatus,
  type ProjectId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { agentMessages, agentSessions } from '../schema/agent.js'
import { isUniqueViolation } from '../unique-violation.js'

/** drizzle の row 型。パッケージ外へは出さない（テストだけが使う）。 */
export type AgentSessionRow = typeof agentSessions.$inferSelect
export type AgentMessageRow = typeof agentMessages.$inferSelect

/** 同じ作品で、別の会話がもう作業中（`agent_sessions_project_busy_uidx` に当たった）。 */
export class AgentSessionBusyError extends Error {
  override readonly name = 'AgentSessionBusyError'
  constructor(readonly projectId: string) {
    super(`この作品では別の会話が作業中です: ${projectId}`)
  }
}

export type CreateAgentSessionRecord = {
  readonly projectId: ProjectId
  readonly title: string
  readonly model: string
}

export type AgentSessionPatch = {
  readonly title?: string
  readonly model?: string
  readonly confirmationsWaived?: boolean
}

/** 1 回のやりとりが終わったときに足すもの。 */
export type AgentTurnRecord = {
  readonly addCostUsd: number
  readonly addEditCount: number
  /** 最後の返事の 1 行目。返事が無ければ null（前の値を残す）。 */
  readonly lastSummary: string | null
  readonly at: Date
}

/** AI エージェントの会話と会話の行の読み書き（ADR-0058）。戻り値は必ず `@ixa/domain` の型。 */
export type AgentSessionRepository = {
  create(input: CreateAgentSessionRecord): Promise<AgentSession>
  findById(id: AgentSessionId): Promise<AgentSession | null>
  /** 作品の会話（最後に話した順。一覧の並びは domain の `sortAgentSessionsForList`）。 */
  findByProject(projectId: ProjectId): Promise<AgentSession[]>
  /** 作品で作業中（確認待ちを含む）の会話。 */
  findBusyInProject(projectId: ProjectId): Promise<AgentSession | null>
  update(id: AgentSessionId, patch: AgentSessionPatch): Promise<AgentSession>
  /**
   * 状態を進める。今の状態から `to` へ進めなければ null（domain の `canTransitionAgentSession`）。
   * 同じ作品で別の会話が作業中なら `AgentSessionBusyError`。
   */
  transition(id: AgentSessionId, to: AgentSessionStatus, at: Date): Promise<AgentSession | null>
  setCliSessionId(id: AgentSessionId, cliSessionId: string): Promise<void>
  recordTurn(id: AgentSessionId, turn: AgentTurnRecord): Promise<AgentSession>
  /** 作業中・確認待ちのまま残った会話をすべて中断にする（API の起動時）。中断にした会話を返す。 */
  interruptAllBusy(at: Date): Promise<AgentSession[]>
  /** 会話の行を足す。通し番号は会話の中で続きから振る。 */
  appendMessages(sessionId: AgentSessionId, bodies: readonly AgentMessageBody[]): Promise<AgentMessage[]>
  /** `afterSeq` より後の行（通し番号の順）。 */
  listMessages(sessionId: AgentSessionId, afterSeq: number): Promise<AgentMessage[]>
}

/** row → Domain。形の違う行は黙って読み替えず失敗する。 */
export const agentSessionRowToDomain = (row: AgentSessionRow): AgentSession =>
  AgentSessionSchema.parse({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    model: row.model,
    cliSessionId: row.cliSessionId,
    status: row.status,
    confirmationsWaived: row.confirmationsWaived,
    costUsd: row.costUsd,
    editCount: row.editCount,
    lastSummary: row.lastSummary,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
  })

export const agentMessageRowToDomain = (row: AgentMessageRow): AgentMessage =>
  AgentMessageSchema.parse({ sessionId: row.sessionId, seq: row.seq, body: row.body, createdAt: row.createdAt })

const BUSY_STATUSES: readonly AgentSessionStatus[] = ['running', 'awaiting_approval']

const fromStatusesInto = (to: AgentSessionStatus): AgentSessionStatus[] =>
  AgentSessionStatusSchema.options.filter((from) => canTransitionAgentSession(from, to))

export const createAgentSessionRepository = (db: DbExecutor): AgentSessionRepository => {
  const mustFind = async (id: AgentSessionId): Promise<AgentSessionRow> => {
    const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).limit(1)
    if (row === undefined) throw new DbNotFoundError('agent_sessions', id)
    return row
  }

  return {
    async create(input) {
      const [row] = await db
        .insert(agentSessions)
        .values({ id: newId(AgentSessionIdSchema), ...input, status: 'idle' })
        .returning()
      if (row === undefined) throw new Error('会話を保存できませんでした')
      return agentSessionRowToDomain(row)
    },

    async findById(id) {
      const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).limit(1)
      return row === undefined ? null : agentSessionRowToDomain(row)
    },

    async findByProject(projectId) {
      const rows = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.projectId, projectId))
        .orderBy(desc(agentSessions.lastActiveAt), desc(agentSessions.id))
      return rows.map(agentSessionRowToDomain)
    },

    async findBusyInProject(projectId) {
      const [row] = await db
        .select()
        .from(agentSessions)
        .where(and(eq(agentSessions.projectId, projectId), inArray(agentSessions.status, [...BUSY_STATUSES])))
        .limit(1)
      return row === undefined ? null : agentSessionRowToDomain(row)
    },

    async update(id, patch) {
      const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      if (Object.keys(values).length === 0) return agentSessionRowToDomain(await mustFind(id))
      const [row] = await db.update(agentSessions).set(values).where(eq(agentSessions.id, id)).returning()
      if (row === undefined) throw new DbNotFoundError('agent_sessions', id)
      return agentSessionRowToDomain(row)
    },

    async transition(id, to, at) {
      const current = await mustFind(id)
      try {
        const [row] = await db
          .update(agentSessions)
          .set({ status: to, lastActiveAt: at })
          .where(and(eq(agentSessions.id, id), inArray(agentSessions.status, fromStatusesInto(to))))
          .returning()
        return row === undefined ? null : agentSessionRowToDomain(row)
      } catch (error) {
        if (isUniqueViolation(error)) throw new AgentSessionBusyError(current.projectId)
        throw new Error(`会話の状態を ${to} にできませんでした`, { cause: error })
      }
    },

    async setCliSessionId(id, cliSessionId) {
      await db.update(agentSessions).set({ cliSessionId }).where(eq(agentSessions.id, id))
    },

    async recordTurn(id, turn) {
      const [row] = await db
        .update(agentSessions)
        .set({
          costUsd: sql`${agentSessions.costUsd} + ${Math.max(0, turn.addCostUsd)}`,
          editCount: sql`${agentSessions.editCount} + ${Math.max(0, Math.trunc(turn.addEditCount))}`,
          lastActiveAt: turn.at,
          ...(turn.lastSummary === null ? {} : { lastSummary: turn.lastSummary }),
        })
        .where(eq(agentSessions.id, id))
        .returning()
      if (row === undefined) throw new DbNotFoundError('agent_sessions', id)
      return agentSessionRowToDomain(row)
    },

    async interruptAllBusy(at) {
      const rows = await db
        .update(agentSessions)
        .set({ status: 'interrupted', lastActiveAt: at })
        .where(inArray(agentSessions.status, [...BUSY_STATUSES]))
        .returning()
      return rows.map(agentSessionRowToDomain)
    },

    async appendMessages(sessionId, bodies) {
      if (bodies.length === 0) return []
      const validated = bodies.map((body) => AgentMessageBodySchema.parse(body))
      return db.transaction(async (tx) => {
        // 会話の行を押さえてから最後の番号を読む（同じ会話へ同時に足しても番号がぶつからない）。
        const locked = await tx
          .select({ id: agentSessions.id })
          .from(agentSessions)
          .where(eq(agentSessions.id, sessionId))
          .for('update')
        if (locked.length === 0) throw new DbNotFoundError('agent_sessions', sessionId)
        const [last] = await tx
          .select({ seq: sql<number>`coalesce(max(${agentMessages.seq}), 0)` })
          .from(agentMessages)
          .where(eq(agentMessages.sessionId, sessionId))
        const start = Number(last?.seq ?? 0) + 1
        const rows = await tx
          .insert(agentMessages)
          .values(validated.map((body, i) => ({ sessionId, seq: start + i, body })))
          .returning()
        return rows.map(agentMessageRowToDomain).sort((a, b) => a.seq - b.seq)
      })
    },

    async listMessages(sessionId, afterSeq) {
      const rows = await db
        .select()
        .from(agentMessages)
        .where(and(eq(agentMessages.sessionId, sessionId), gt(agentMessages.seq, afterSeq)))
        .orderBy(asc(agentMessages.seq))
      return rows.map(agentMessageRowToDomain)
    },
  }
}
