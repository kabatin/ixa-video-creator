import { ProjectId, type AgentMessageBody } from '@ixa/domain'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { AgentSessionBusyError, createAgentSessionRepository } from '../repositories/agent-session-repository.js'

/**
 * AI エージェントの会話（ADR-0058）を**実際の Postgres で**確かめる。通し番号・1 作品 1 動作・起動時の中断。
 * 全部を外側のトランザクションに入れ、最後に必ず巻き戻す。`DATABASE_URL` が無ければ飛ばす（skipped に出る）。
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

const insertProject = async (tx: DbExecutor): Promise<ProjectId> => {
  const ws = '01M5WSAGENT000000000000000'
  const pj = ProjectId.parse('01M5PJAGENT000000000000000')
  await tx.execute(sql`insert into workspaces (id, name) values (${ws}, '結合テスト（巻き戻す）') on conflict do nothing`)
  await tx.execute(sql`insert into projects (id, workspace_id, name, fps, resolution, aspect_ratio, status)
    values (${pj}, ${ws}, '結合テスト（巻き戻す）', 24, '{"width":1280,"height":720}'::jsonb, '16:9', 'production') on conflict do nothing`)
  return pj
}

const text = (t: string): AgentMessageBody => ({ kind: 'assistant_text', text: t })

describe.skipIf(url === undefined)('agent_sessions（実際の DB）', () => {
  it('会話の行は、会話ごとに 1 から続きの番号が振られる', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createAgentSessionRepository(tx)
      const projectId = await insertProject(tx)
      const a = await repo.create({ projectId, title: 'A', model: 'claude-sonnet-5-5' })
      const b = await repo.create({ projectId, title: 'B', model: 'claude-sonnet-5-5' })
      await repo.appendMessages(a.id, [text('1'), text('2')])
      await repo.appendMessages(b.id, [text('b1')])
      const more = await repo.appendMessages(a.id, [text('3')])
      expect(more.map((m) => m.seq)).toEqual([3])
      expect((await repo.listMessages(a.id, 1)).map((m) => [m.seq, m.body])).toEqual([
        [2, text('2')],
        [3, text('3')],
      ])
      expect((await repo.listMessages(b.id, 0)).map((m) => m.seq)).toEqual([1])
    })
  })

  it('同じ作品で 2 つ目を作業中にしようとすると断る。決めていない遷移は null', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createAgentSessionRepository(tx)
      const projectId = await insertProject(tx)
      const now = new Date('2026-10-23T00:00:00Z')
      const a = await repo.create({ projectId, title: 'A', model: 'claude-sonnet-5-5' })
      const b = await repo.create({ projectId, title: 'B', model: 'claude-sonnet-5-5' })
      expect((await repo.transition(a.id, 'running', now))?.status).toBe('running')
      // 一意制約に当たった文は、外側のトランザクションを壊さないよう SAVEPOINT の中で投げる。
      await expect(
        tx.transaction((inner) => createAgentSessionRepository(inner).transition(b.id, 'running', now)),
      ).rejects.toBeInstanceOf(AgentSessionBusyError)
      expect(await repo.transition(b.id, 'idle', now)).toBeNull()
      expect((await repo.findBusyInProject(projectId))?.id).toBe(a.id)
    })
  })

  it('起動時に、作業中・確認待ちのまま残った会話を中断にする', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createAgentSessionRepository(tx)
      const projectId = await insertProject(tx)
      const now = new Date('2026-10-23T00:00:00Z')
      const a = await repo.create({ projectId, title: 'A', model: 'claude-sonnet-5-5' })
      await repo.transition(a.id, 'running', now)
      await repo.transition(a.id, 'awaiting_approval', now)
      const interrupted = await repo.interruptAllBusy(now)
      expect(interrupted.map((s) => s.id)).toContain(a.id)
      expect((await repo.findById(a.id))?.status).toBe('interrupted')
    })
  })

  it('やりとりの終わりに、費用と直した数を足し、要約を残す', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createAgentSessionRepository(tx)
      const projectId = await insertProject(tx)
      const at = new Date('2026-10-23T01:00:00Z')
      const a = await repo.create({ projectId, title: 'A', model: 'claude-sonnet-5-5' })
      await repo.recordTurn(a.id, { addCostUsd: 0.25, addEditCount: 2, lastSummary: '直しました', at })
      const after = await repo.recordTurn(a.id, { addCostUsd: 0.5, addEditCount: 1, lastSummary: null, at })
      expect(after).toMatchObject({ costUsd: 0.75, editCount: 3, lastSummary: '直しました', lastActiveAt: at })
    })
  })
})
