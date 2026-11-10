import { WorkspaceId, newId, type CreateProjectInput } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { createProjectRepository } from '../repositories/project-repository.js'
import { workspaces } from '../schema/workspace.js'

/**
 * 作品の種類と見本の印を**実際の Postgres で**確かめる（列の既定値と、見本の印での引き当て）。
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

const inputFor = (workspaceId: WorkspaceId): CreateProjectInput => ({
  workspaceId,
  name: '結合テスト（巻き戻す）',
  fps: 24,
  resolution: { width: 1280, height: 720 },
  aspectRatio: '16:9',
})

const newWorkspace = async (tx: DbExecutor): Promise<WorkspaceId> => {
  const workspaceId = newId(WorkspaceId)
  await tx.insert(workspaces).values({ id: workspaceId, name: '結合テスト（巻き戻す）' })
  return workspaceId
}

describe.skipIf(url === undefined)('ProjectRepository の種類と見本の印（実際の DB）', () => {
  it('種類を送らなければミュージックビデオ、見本の印は無し。種類は後から変えられる', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      const created = await repo.create(inputFor(await newWorkspace(tx)))
      expect(created).toMatchObject({ kind: 'mv', demoKey: null })
      expect((await repo.update(created.id, { kind: 'library' })).kind).toBe('library')
      expect((await repo.findById(created.id))?.kind).toBe('library')
    })
  })

  it('見本の印で、そのワークスペースの消していない作品を引く', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      const workspaceId = await newWorkspace(tx)
      const other = await newWorkspace(tx)
      expect(await repo.findByDemoKey(workspaceId, 'ixa-demo-v1')).toBeNull()

      const demo = await repo.create({ ...inputFor(workspaceId), kind: 'short' }, { demoKey: 'ixa-demo-v1' })
      expect(demo).toMatchObject({ kind: 'short', demoKey: 'ixa-demo-v1' })
      expect((await repo.findByDemoKey(workspaceId, 'ixa-demo-v1'))?.id).toBe(demo.id)
      expect(await repo.findByDemoKey(other, 'ixa-demo-v1')).toBeNull()

      await repo.softDelete(demo.id)
      expect(await repo.findByDemoKey(workspaceId, 'ixa-demo-v1')).toBeNull()
    })
  })

  it('壊れた見本の印は書かない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      await expect(repo.create(inputFor(await newWorkspace(tx)), { demoKey: 'IXA DEMO' })).rejects.toThrow()
    })
  })
})
