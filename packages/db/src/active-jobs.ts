import { AgentSessionStatus, isAgentSessionBusy } from '@ixa/domain'
import { count, inArray, notInArray } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { DbExecutor } from './client.js'
import { agentSessions } from './schema/agent.js'
import { dubJobs } from './schema/dub.js'
import { generationJobs } from './schema/generation.js'
import { imageGenerationJobs } from './schema/image-job.js'
import { musicJobs } from './schema/music.js'
import { voiceJobs } from './schema/narration.js'
import { renderJobs } from './schema/render.js'
import { sfxJobs } from './schema/sfx.js'
import { upscaleJobs } from './schema/upscale-job.js'

/**
 * 動いているジョブの件数（ADR-0063）。`pnpm ixa update` が「作っている途中で更新して止めない」ために数える。
 *
 * ジョブは**終わった状態（succeeded・failed・cancelled）以外**を動いているとみなす
 * （順番待ち・作っている・チェック中・書き出し中…は種類ごとに名前が違うので、終わりの側で決める）。
 * エージェントの会話は `isAgentSessionBusy`（作業中・確認待ち）と同じ決め方。
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
  'agent',
] as const
export type ActiveJobKind = (typeof ACTIVE_JOB_KINDS)[number]
export type ActiveJobCounts = Readonly<Record<ActiveJobKind, number>>

/** 終わった状態。どのジョブの表でも同じ名前。 */
const FINISHED_STATUSES = ['succeeded', 'failed', 'cancelled'] as const

const BUSY_AGENT_STATUSES = AgentSessionStatus.options.filter(isAgentSessionBusy)

type StatusTable = { readonly table: PgTable; readonly status: PgColumn }

const JOB_TABLES: Readonly<Record<Exclude<ActiveJobKind, 'agent'>, StatusTable>> = {
  generation: { table: generationJobs, status: generationJobs.status },
  render: { table: renderJobs, status: renderJobs.status },
  image: { table: imageGenerationJobs, status: imageGenerationJobs.status },
  music: { table: musicJobs, status: musicJobs.status },
  sfx: { table: sfxJobs, status: sfxJobs.status },
  upscale: { table: upscaleJobs, status: upscaleJobs.status },
  dub: { table: dubJobs, status: dubJobs.status },
  voice: { table: voiceJobs, status: voiceJobs.status },
}

const countRunning = async (db: DbExecutor, { table, status }: StatusTable): Promise<number> => {
  const rows = await db.select({ n: count() }).from(table).where(notInArray(status, [...FINISHED_STATUSES]))
  return rows[0]?.n ?? 0
}

const countBusyAgents = async (db: DbExecutor): Promise<number> => {
  const rows = await db
    .select({ n: count() })
    .from(agentSessions)
    .where(inArray(agentSessions.status, BUSY_AGENT_STATUSES))
  return rows[0]?.n ?? 0
}

/** 表ごとの動いている件数。 */
export const countActiveJobs = async (db: DbExecutor): Promise<ActiveJobCounts> => {
  try {
    const [generation, render, image, music, sfx, upscale, dub, voice, agent] = await Promise.all([
      countRunning(db, JOB_TABLES.generation),
      countRunning(db, JOB_TABLES.render),
      countRunning(db, JOB_TABLES.image),
      countRunning(db, JOB_TABLES.music),
      countRunning(db, JOB_TABLES.sfx),
      countRunning(db, JOB_TABLES.upscale),
      countRunning(db, JOB_TABLES.dub),
      countRunning(db, JOB_TABLES.voice),
      countBusyAgents(db),
    ])
    return { generation, render, image, music, sfx, upscale, dub, voice, agent }
  } catch (error) {
    throw new Error(`動いているジョブを数えられませんでした: ${String(error)}`, { cause: error })
  }
}
