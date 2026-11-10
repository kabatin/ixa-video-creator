import { WorkspaceId, newId, type CreateProjectInput } from '@ixa/domain'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { createProjectRepository } from '../repositories/project-repository.js'
import { isUniqueViolation } from '../unique-violation.js'
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

  /** 見本の印は、ワークスペースの生きている作品で 1 つだけ（部分一意索引）。消した後と、別のワークスペースは入れられる。 */
  it('同じワークスペースに同じ印の生きている作品は 2 つ作れない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      const workspaceId = await newWorkspace(tx)
      const first = await repo.create(inputFor(workspaceId), { demoKey: 'ixa-demo-v1' })
      await expect(
        tx.transaction(async (inner) => {
          await createProjectRepository(inner).create(inputFor(workspaceId), { demoKey: 'ixa-demo-v1' })
        }),
      ).rejects.toThrow()

      expect((await repo.create(inputFor(await newWorkspace(tx)), { demoKey: 'ixa-demo-v1' })).demoKey).toBe('ixa-demo-v1')
      // 印の無い作品は、いくつあってもよい。
      await repo.create(inputFor(workspaceId))
      await repo.create(inputFor(workspaceId))

      await repo.softDelete(first.id)
      const again = await repo.create(inputFor(workspaceId), { demoKey: 'ixa-demo-v1' })
      expect((await repo.findByDemoKey(workspaceId, 'ixa-demo-v1'))?.id).toBe(again.id)
    })
  })

  /** 見本を入れる処理は、全部書き終えてから最後に印を付ける（書きかけの作品を「入っている」と読ませない。ADR-0067）。 */
  it('印を後から付ける: 生きている持ち主がいれば一意索引にぶつかり、持ち主を消した後は付けられる', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      const workspaceId = await newWorkspace(tx)
      const holder = await repo.create(inputFor(workspaceId))
      const challenger = await repo.create(inputFor(workspaceId))
      expect((await repo.setDemoKey(holder.id, 'ixa-demo-v1')).demoKey).toBe('ixa-demo-v1')

      const clash: unknown = await tx
        .transaction(async (inner) => {
          await createProjectRepository(inner).setDemoKey(challenger.id, 'ixa-demo-v1')
        })
        .catch((error: unknown) => error)
      expect(isUniqueViolation(clash)).toBe(true)
      expect((await repo.findById(challenger.id))?.demoKey).toBeNull()

      await repo.softDelete(holder.id)
      expect((await repo.setDemoKey(challenger.id, 'ixa-demo-v1')).demoKey).toBe('ixa-demo-v1')
      expect((await repo.findByDemoKey(workspaceId, 'ixa-demo-v1'))?.id).toBe(challenger.id)
    })
  })

  it('消した作品・壊れた印には付けない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      const project = await repo.create(inputFor(await newWorkspace(tx)))
      await expect(repo.setDemoKey(project.id, 'IXA DEMO')).rejects.toThrow()
      await repo.softDelete(project.id)
      await expect(repo.setDemoKey(project.id, 'ixa-demo-v1')).rejects.toBeInstanceOf(DbNotFoundError)
    })
  })

  it('作業場所があるかを読む（ある ID・無い ID・消した作業場所）', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      const workspaceId = await newWorkspace(tx)
      expect(await repo.workspaceExists(workspaceId)).toBe(true)
      expect(await repo.workspaceExists(newId(WorkspaceId))).toBe(false)
      await tx.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, workspaceId))
      expect(await repo.workspaceExists(workspaceId)).toBe(false)
    })
  })

  it('壊れた見本の印は書かない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createProjectRepository(tx)
      await expect(repo.create(inputFor(await newWorkspace(tx)), { demoKey: 'IXA DEMO' })).rejects.toThrow()
    })
  })
})
