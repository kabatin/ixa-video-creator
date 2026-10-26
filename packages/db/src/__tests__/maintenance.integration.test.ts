import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { countActiveJobs } from '../active-jobs.js'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { pendingMigrations, readMigrationJournal } from '../migrations.js'

/**
 * `pnpm ixa` の点検（ADR-0063）を**実際の Postgres で**確かめる。DB の更新を当て終えた DB を前提にする。
 * 全部を外側のトランザクションに入れ、最後に必ず巻き戻す（DDL も Postgres では巻き戻る）。
 * `DATABASE_URL` が無ければ飛ばす（skipped に出る）。
 */

const url = process.env['DATABASE_URL']

class Rollback extends Error {}

const inRolledBackTransaction = async (body: (tx: DbExecutor) => Promise<void>): Promise<void> => {
  if (url === undefined) throw new Error('DATABASE_URL がありません')
  const db = createDbClient(url, { maxConnections: 1 })
  try {
    await db.transaction(async (tx) => {
      await body(tx)
      throw new Rollback('後片付け')
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  } finally {
    await closeDbClient(db)
  }
}

const WS = '01M5WSMA1NT000000000000000'
const PJ = '01M5PJMA1NT000000000000000'

const insertProject = async (tx: DbExecutor): Promise<void> => {
  await tx.execute(sql`insert into workspaces (id, name) values (${WS}, '結合テスト（巻き戻す）') on conflict do nothing`)
  await tx.execute(sql`insert into projects (id, workspace_id, name, fps, resolution, aspect_ratio, status)
    values (${PJ}, ${WS}, '結合テスト（巻き戻す）', 24, '{"width":1280,"height":720}'::jsonb, '16:9', 'production') on conflict do nothing`)
}

const insertRenderJob = async (tx: DbExecutor, id: string, status: string): Promise<void> => {
  await tx.execute(sql`insert into render_jobs (id, project_id, scope, preset, timeline_snapshot, status)
    values (${id}, ${PJ}, '{"kind":"all"}'::jsonb, 'h264_1080p', '{}'::jsonb, ${status})`)
}

const insertAgentSession = async (tx: DbExecutor, id: string, status: string): Promise<void> => {
  await tx.execute(sql`insert into agent_sessions (id, project_id, title, model, status)
    values (${id}, ${PJ}, 't', 'claude-sonnet-5-5', ${status})`)
}

describe.skipIf(url === undefined)('DB の点検（実際の DB）', () => {
  it('当て終えた DB では、まだの更新は無い', async () => {
    await inRolledBackTransaction(async (tx) => {
      expect(await pendingMigrations(tx, await readMigrationJournal())).toEqual([])
    })
  })

  it('最後の 2 本の記録を消すと、その 2 本が「まだ」になる', async () => {
    const journal = await readMigrationJournal()
    const lastTwo = journal.entries.slice(-2)
    await inRolledBackTransaction(async (tx) => {
      const since = lastTwo[0]?.when ?? 0
      await tx.execute(sql`delete from drizzle.__drizzle_migrations where created_at >= ${since}`)
      expect(await pendingMigrations(tx, journal)).toEqual(lastTwo.map((entry) => entry.tag))
    })
  })

  it('記録の表が無ければ（1 本も当てていない）全部が「まだ」', async () => {
    const journal = await readMigrationJournal()
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql`alter table drizzle.__drizzle_migrations rename to __drizzle_migrations_hidden`)
      expect(await pendingMigrations(tx, journal)).toHaveLength(journal.entries.length)
    })
  })

  it('終わっていないジョブと作業中の会話だけを数える', async () => {
    await inRolledBackTransaction(async (tx) => {
      const before = (await countActiveJobs(tx)).counts
      await insertProject(tx)
      await insertRenderJob(tx, '01M5RJMAINTQUEUED000000000', 'queued')
      await insertRenderJob(tx, '01M5RJMAINTENCODING0000000', 'encoding')
      await insertRenderJob(tx, '01M5RJMAINTDONE00000000000', 'succeeded')
      await insertRenderJob(tx, '01M5RJMAINTCANCEL00000000Z', 'cancelled')
      await insertAgentSession(tx, '01M5AGMAINTBUSY00000000000', 'awaiting_approval')
      const after = (await countActiveJobs(tx)).counts
      expect(after.render - before.render).toBe(2)
      expect(after.agent - before.agent).toBe(1)
      expect(after.generation).toBe(before.generation)
    })
  })

  it('作業中でない会話は数えない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const before = (await countActiveJobs(tx)).counts
      await insertProject(tx)
      await insertAgentSession(tx, '01M5AGMAINTIDLE00000000000', 'idle')
      expect(((await countActiveJobs(tx)).counts).agent).toBe(before.agent)
    })
  })

  it('絵コンテの案は running を数え done は数えない。2 日前から running のままの行は取り残しとして並べる', async () => {
    await inRolledBackTransaction(async (tx) => {
      const before = await countActiveJobs(tx)
      await insertProject(tx)
      await tx.execute(sql`insert into storyboard_draft_runs (id, project_id, drafter, status)
        values ('01M5SBMA1NTRUN00000000000Z', ${PJ}, 'stub', 'running'), ('01M5SBMA1NTD0NE0000000000Z', ${PJ}, 'stub', 'done')`)
      await tx.execute(sql`insert into storyboard_draft_runs (id, project_id, drafter, status, created_at)
        values ('01M5SBMA1NTZ0MB1E00000000Z', ${PJ}, 'stub', 'running', now() - interval '2 days')`)
      const after = await countActiveJobs(tx)
      expect(after.counts.storyboard - before.counts.storyboard).toBe(1)
      expect(after.stale.map((s) => s.id)).toContain('01M5SBMA1NTZ0MB1E00000000Z')
    })
  })
})
