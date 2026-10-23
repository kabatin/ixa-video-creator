import { sql } from 'drizzle-orm'
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'
import {
  AgentSessionStatus as AgentSessionStatusSchema,
  type AgentMessageBody,
  type AgentSessionStatus,
} from '@ixa/domain'
import { createdAt, timestampTz, ulidPk, ulidRef } from './columns.js'
import { projects } from './workspace.js'

/**
 * AI エージェントの会話（タスク）（ADR-0058）。作品ごとに残り、続きから話せる。
 *
 * 同じ作品で同時に動けるのは 1 つだけ（編集のぶつかりを避ける）。`agent_sessions_project_busy_uidx` が DB でも守る。
 */
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    model: text('model').notNull(),
    /** CLI の会話 ID（`--resume` に渡す）。最初のやりとりが始まるまでは null。 */
    cliSessionId: text('cli_session_id'),
    status: text('status', { enum: AgentSessionStatusSchema.options }).$type<AgentSessionStatus>().notNull(),
    confirmationsWaived: boolean('confirmations_waived').notNull().default(false),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    editCount: integer('edit_count').notNull().default(0),
    lastSummary: text('last_summary'),
    createdAt: createdAt(),
    lastActiveAt: timestampTz('last_active_at').notNull().defaultNow(),
  },
  (t) => [
    index('agent_sessions_project_last_active_idx').on(t.projectId, t.lastActiveAt),
    uniqueIndex('agent_sessions_project_busy_uidx')
      .on(t.projectId)
      .where(sql`${t.status} in ('running', 'awaiting_approval')`),
  ],
)

/**
 * 会話の行。★ 追記のみ。会話ごとの通し番号（`seq`、1 から）で並び、画面はその続きから受け取る。
 * 中身は種類ごとに形が決まる（domain の `AgentMessageBody`）。鍵と署名付き URL は入れない。
 */
export const agentMessages = pgTable(
  'agent_messages',
  {
    sessionId: ulidRef('session_id')
      .notNull()
      .references(() => agentSessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    body: jsonb('body').$type<AgentMessageBody>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: 'agent_messages_pk', columns: [t.sessionId, t.seq] })],
)
