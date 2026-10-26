import { AgentSessionStatus, isAgentSessionBusy } from '@ixa/domain'
import { inArray } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { DbExecutor } from './client.js'
import { agentSessions } from './schema/agent.js'
import { dubJobs } from './schema/dub.js'
import { generationJobs } from './schema/generation.js'
import { imageGenerationJobs } from './schema/image-job.js'
import { musicJobs } from './schema/music.js'
import { voiceJobs } from './schema/narration.js'
import { renderJobs } from './schema/render.js'
import { reviewRuns } from './schema/review.js'
import { sfxJobs } from './schema/sfx.js'
import { storyboardDraftRuns } from './schema/storyboard.js'
import { thumbnails } from './schema/thumbnail.js'
import { upscaleJobs } from './schema/upscale-job.js'

/**
 * 動いているジョブ（ADR-0063）。`pnpm ixa update` が「作っている途中で更新して止めない」ために数える。
 *
 * **表ごとに「動いている状態」を名前で持つ。** 終わりの状態は表で違う（`succeeded` の表と `done` の表がある）ので、
 * 終わりの側では決めない。会話は `isAgentSessionBusy`（作業中・確認待ち）と同じ決め方。
 *
 * **24 時間より前から動いたままの行は数えない**（取り残し。worker が落ちて状態が戻らなかった行など）。
 * 数えると更新がいつまでも止まるので、`stale` に並べて知らせるだけにする。
 */

export const ACTIVE_JOB_KINDS = [
  'generation',
  'render',
  'image',
  'music',
  'sfx',
  'upscale',
  'dub',
  'voice',
  'storyboard',
  'review',
  'thumbnail',
  'agent',
] as const
export type ActiveJobKind = (typeof ACTIVE_JOB_KINDS)[number]
export type ActiveJobCounts = Readonly<Record<ActiveJobKind, number>>

/** 取り残しとみなすまでの時間。 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export type StaleJob = { readonly kind: ActiveJobKind; readonly id: string; readonly since: string }
export type ActiveJobs = { readonly counts: ActiveJobCounts; readonly stale: readonly StaleJob[] }

type ActiveRow = { readonly kind: ActiveJobKind; readonly id: string; readonly since: Date }

type JobTable = {
  readonly table: PgTable
  readonly id: PgColumn
  readonly status: PgColumn
  /** 動き始めた目安の時刻（積んだ時刻か作った時刻）。 */
  readonly since: PgColumn
  readonly active: readonly string[]
}

const QUEUED_OR_RUNNING = ['queued', 'running'] as const

const JOB_TABLES: Readonly<Record<ActiveJobKind, JobTable>> = {
  generation: { table: generationJobs, id: generationJobs.id, status: generationJobs.status, since: generationJobs.queuedAt, active: QUEUED_OR_RUNNING },
  render: { table: renderJobs, id: renderJobs.id, status: renderJobs.status, since: renderJobs.createdAt, active: ['queued', 'rendering', 'encoding'] },
  image: { table: imageGenerationJobs, id: imageGenerationJobs.id, status: imageGenerationJobs.status, since: imageGenerationJobs.queuedAt, active: ['queued', 'running', 'checking'] },
  music: { table: musicJobs, id: musicJobs.id, status: musicJobs.status, since: musicJobs.queuedAt, active: QUEUED_OR_RUNNING },
  sfx: { table: sfxJobs, id: sfxJobs.id, status: sfxJobs.status, since: sfxJobs.queuedAt, active: QUEUED_OR_RUNNING },
  upscale: { table: upscaleJobs, id: upscaleJobs.id, status: upscaleJobs.status, since: upscaleJobs.queuedAt, active: QUEUED_OR_RUNNING },
  dub: { table: dubJobs, id: dubJobs.id, status: dubJobs.status, since: dubJobs.queuedAt, active: QUEUED_OR_RUNNING },
  voice: { table: voiceJobs, id: voiceJobs.id, status: voiceJobs.status, since: voiceJobs.queuedAt, active: QUEUED_OR_RUNNING },
  storyboard: { table: storyboardDraftRuns, id: storyboardDraftRuns.id, status: storyboardDraftRuns.status, since: storyboardDraftRuns.createdAt, active: QUEUED_OR_RUNNING },
  review: { table: reviewRuns, id: reviewRuns.id, status: reviewRuns.status, since: reviewRuns.createdAt, active: QUEUED_OR_RUNNING },
  thumbnail: { table: thumbnails, id: thumbnails.id, status: thumbnails.status, since: thumbnails.createdAt, active: ['queued', 'rendering'] },
  agent: {
    table: agentSessions,
    id: agentSessions.id,
    status: agentSessions.status,
    since: agentSessions.lastActiveAt,
    active: AgentSessionStatus.options.filter(isAgentSessionBusy),
  },
}

/** 数える（純粋）。取り残しは数えず `stale` へ。 */
export const summarizeActiveRows = (rows: readonly ActiveRow[], now: Date): ActiveJobs => {
  const isStale = (row: ActiveRow) => now.getTime() - row.since.getTime() > STALE_AFTER_MS
  const live = rows.filter((row) => !isStale(row))
  const counts = Object.fromEntries(
    ACTIVE_JOB_KINDS.map((kind) => [kind, live.filter((row) => row.kind === kind).length]),
  ) as Record<ActiveJobKind, number>
  return {
    counts,
    stale: rows.filter(isStale).map((row) => ({ kind: row.kind, id: row.id, since: row.since.toISOString() })),
  }
}

const activeRowsOf = async (db: DbExecutor, kind: ActiveJobKind): Promise<readonly ActiveRow[]> => {
  const { table, id, status, since, active } = JOB_TABLES[kind]
  const rows = await db.select({ id, since }).from(table).where(inArray(status, [...active]))
  return rows.map((row) => ({ kind, id: String(row.id), since: new Date(row.since as Date | string) }))
}

/** 表ごとの動いている件数と、取り残しの行。 */
export const countActiveJobs = async (db: DbExecutor, now: Date = new Date()): Promise<ActiveJobs> => {
  try {
    const rows = await Promise.all(ACTIVE_JOB_KINDS.map((kind) => activeRowsOf(db, kind)))
    return summarizeActiveRows(rows.flat(), now)
  } catch (error) {
    throw new Error(`動いているジョブを数えられませんでした: ${String(error)}`, { cause: error })
  }
}
