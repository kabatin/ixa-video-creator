import { EditBatchId, MediaAssetId, ProjectId, RenderJobId, ShotId, TakeId, WorkspaceId, newId } from '@ixa/domain'
import { sql, type SQL } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { createProjectRepository } from '../repositories/project-repository.js'

/**
 * 作品一覧の進み具合（`findByWorkspaceWithActivity`）を**実際の Postgres で**確かめる。
 * 数え方（消した Shot を数えない・採用の有無・書き出しの成功だけ）と、最終更新の 4 つの出どころ。
 * 全部を外側のトランザクションに入れ、最後に必ず巻き戻す。`DATABASE_URL` が無ければ飛ばす（skipped に出る）。
 *
 * **時刻はすべて明示する。** トランザクションの中では `now()` が止まっていて、既定値では順番が付かない。
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

const at = (iso: string): Date => new Date(iso)
const BASE = '2026-11-01T00:00:00.000Z'

/** 素の SQL へ時刻を渡す（Date はそのままでは送れない）。 */
const ts = (value: Date | null): SQL =>
  value === null ? sql`null` : sql`${value.toISOString()}::timestamptz`

const newWorkspace = async (tx: DbExecutor): Promise<WorkspaceId> => {
  const workspaceId = newId(WorkspaceId)
  await tx.execute(sql`insert into workspaces (id, name) values (${workspaceId}, '結合テスト（巻き戻す）')`)
  return workspaceId
}

/** 作品を 1 件。作った時刻と直した時刻は `updatedAt` に揃える。 */
const insertProject = async (
  tx: DbExecutor,
  workspaceId: WorkspaceId,
  options: { readonly updatedAt?: Date; readonly deleted?: boolean } = {},
): Promise<ProjectId> => {
  const id = newId(ProjectId)
  const updatedAt = options.updatedAt ?? at(BASE)
  await tx.execute(sql`insert into projects (id, workspace_id, name, fps, resolution, aspect_ratio, status, created_at, updated_at, deleted_at)
    values (${id}, ${workspaceId}, '結合テスト（巻き戻す）', 24, '{"width":1280,"height":720}'::jsonb, '16:9', 'planning',
      ${ts(updatedAt)}, ${ts(updatedAt)}, ${ts(options.deleted === true ? updatedAt : null)})`)
  return id
}

let shotSeq = 0

const insertShot = async (
  tx: DbExecutor,
  projectId: ProjectId,
  options: { readonly deleted?: boolean } = {},
): Promise<string> => {
  shotSeq += 1
  const id = newId(ShotId)
  await tx.execute(sql`insert into shots (id, project_id, "order", code, start_sec, duration_sec, camera, source_type, status, created_at, updated_at, deleted_at)
    values (${id}, ${projectId}, ${shotSeq * 1000}, ${`IT-${String(shotSeq)}`}, 0, 4, '{}'::jsonb, '{"type":"t2v"}'::jsonb, 'draft',
      ${ts(at(BASE))}, ${ts(at(BASE))}, ${ts(options.deleted === true ? at(BASE) : null)})`)
  return id
}

/** Take を 1 本（素材も）。`adopt` なら Shot の採用にする。 */
const insertTake = async (
  tx: DbExecutor,
  workspaceId: WorkspaceId,
  shotId: string,
  options: { readonly createdAt?: Date; readonly adopt?: boolean } = {},
): Promise<void> => {
  const takeId = newId(TakeId)
  const assetId = newId(MediaAssetId)
  await tx.execute(sql`insert into media_assets (id, workspace_id, kind, storage_key, mime_type, bytes, checksum_sha256, origin)
    values (${assetId}, ${workspaceId}, 'video', 'k', 'video/mp4', 1, ${`it-${takeId}`}, '{"type":"upload"}'::jsonb)`)
  await tx.execute(sql`insert into takes (id, shot_id, index, media_asset_id, spec, spec_hash, provider_id, model_id, provider_params, cost_usd, generation_time_sec, created_at)
    values (${takeId}, ${shotId}, (select coalesce(max(index), 0) + 1 from takes where shot_id = ${shotId}), ${assetId}, '{}'::jsonb, 'h', 'stub', 'stub', '{}'::jsonb, 0, 0,
      ${ts(options.createdAt ?? at(BASE))})`)
  if (options.adopt === true) {
    await tx.execute(sql`update shots set selected_take_id = ${takeId} where id = ${shotId}`)
  }
}

const insertRender = async (
  tx: DbExecutor,
  projectId: ProjectId,
  status: 'succeeded' | 'failed' | 'queued',
  createdAt: Date = at(BASE),
): Promise<void> => {
  const id = newId(RenderJobId)
  await tx.execute(sql`insert into render_jobs (id, project_id, scope, preset, timeline_snapshot, status, created_at)
    values (${id}, ${projectId}, '{"type":"full"}'::jsonb, 'preview', '{}'::jsonb, ${status}, ${ts(createdAt)})`)
}

const insertEditBatch = async (
  tx: DbExecutor,
  projectId: ProjectId,
  createdAt: Date,
  undoneAt: Date | null = null,
): Promise<void> => {
  const id = newId(EditBatchId)
  await tx.execute(sql`insert into shot_edit_batches (id, project_id, kind, summary, entries, created_at, undone_at)
    values (${id}, ${projectId}, 'shot_edit', '結合テスト', '[]'::jsonb, ${ts(createdAt)}, ${ts(undoneAt)})`)
}

const activityOf = async (tx: DbExecutor, workspaceId: WorkspaceId, projectId: ProjectId) => {
  const rows = await createProjectRepository(tx).findByWorkspaceWithActivity(workspaceId)
  const found = rows.find((row) => row.project.id === projectId)
  if (found === undefined) throw new Error('一覧に作品がありません')
  return found.activity
}

describe.skipIf(url === undefined)('findByWorkspaceWithActivity（実際の DB）', () => {
  it('Shot の無い作品は 0 件で、最終更新は作品を直した時刻', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ws = await newWorkspace(tx)
      const project = await insertProject(tx, ws, { updatedAt: at('2026-11-02T03:04:05.000Z') })
      expect(await activityOf(tx, ws, project)).toEqual({
        lastActivityAt: at('2026-11-02T03:04:05.000Z'),
        shotCount: 0,
        adoptedTakeCount: 0,
        hasRender: false,
      })
    })
  })

  it('消した Shot は数えず、採用している生きた Shot だけを採用に数える', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ws = await newWorkspace(tx)
      const project = await insertProject(tx, ws)
      const adopted = await insertShot(tx, project)
      const notAdopted = await insertShot(tx, project)
      await insertShot(tx, project)
      await insertTake(tx, ws, adopted, { adopt: true })
      await insertTake(tx, ws, notAdopted)
      // 消した Shot は採用していても数えない。
      const deleted = await insertShot(tx, project, { deleted: true })
      await insertTake(tx, ws, deleted, { adopt: true })
      await insertShot(tx, project, { deleted: true })

      const activity = await activityOf(tx, ws, project)
      expect(activity.shotCount).toBe(3)
      expect(activity.adoptedTakeCount).toBe(1)
    })
  })

  it('書き出しは成功したものだけを「書き出し済み」にする', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ws = await newWorkspace(tx)
      const failedOnly = await insertProject(tx, ws)
      await insertRender(tx, failedOnly, 'failed')
      await insertRender(tx, failedOnly, 'queued')
      const finished = await insertProject(tx, ws)
      await insertRender(tx, finished, 'failed')
      await insertRender(tx, finished, 'succeeded')

      expect((await activityOf(tx, ws, failedOnly)).hasRender).toBe(false)
      expect((await activityOf(tx, ws, finished)).hasRender).toBe(true)
    })
  })

  it('最終更新は 4 つの出どころのうち一番新しい時刻（それぞれが勝つ）', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ws = await newWorkspace(tx)
      const project = await insertProject(tx, ws, { updatedAt: at('2026-11-01T00:00:00.000Z') })
      const shot = await insertShot(tx, project)
      await insertTake(tx, ws, shot, { createdAt: at('2026-10-31T00:00:00.000Z') })
      await insertRender(tx, project, 'failed', at('2026-10-30T00:00:00.000Z'))
      await insertEditBatch(tx, project, at('2026-10-29T00:00:00.000Z'))
      // 作品を直した時刻が一番新しい。
      expect((await activityOf(tx, ws, project)).lastActivityAt).toEqual(at('2026-11-01T00:00:00.000Z'))

      await insertEditBatch(tx, project, at('2026-11-02T00:00:00.000Z'))
      expect((await activityOf(tx, ws, project)).lastActivityAt).toEqual(at('2026-11-02T00:00:00.000Z'))

      // 取り消した時刻も触った時刻。
      await insertEditBatch(tx, project, at('2026-10-01T00:00:00.000Z'), at('2026-11-03T00:00:00.000Z'))
      expect((await activityOf(tx, ws, project)).lastActivityAt).toEqual(at('2026-11-03T00:00:00.000Z'))

      // 消した Shot の Take でも、作ったのは作品の作業。
      const deletedShot = await insertShot(tx, project, { deleted: true })
      await insertTake(tx, ws, deletedShot, { createdAt: at('2026-11-04T00:00:00.000Z') })
      expect((await activityOf(tx, ws, project)).lastActivityAt).toEqual(at('2026-11-04T00:00:00.000Z'))

      // 失敗した書き出しも、書き出そうとした時刻。
      await insertRender(tx, project, 'failed', at('2026-11-05T00:00:00.000Z'))
      expect((await activityOf(tx, ws, project)).lastActivityAt).toEqual(at('2026-11-05T00:00:00.000Z'))
    })
  })

  it('消した作品と、別のワークスペースの作品は出さない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ws = await newWorkspace(tx)
      const other = await newWorkspace(tx)
      const live = await insertProject(tx, ws)
      await insertProject(tx, ws, { deleted: true })
      const elsewhere = await insertProject(tx, other)
      await insertShot(tx, elsewhere)

      const rows = await createProjectRepository(tx).findByWorkspaceWithActivity(ws)
      expect(rows.map((row) => row.project.id)).toEqual([live])
      expect(rows[0]?.activity.shotCount).toBe(0)
    })
  })

  it('作品が何件でも、作品の欄は findByWorkspace と同じ並び・同じ値', async () => {
    await inRolledBackTransaction(async (tx) => {
      const ws = await newWorkspace(tx)
      await insertProject(tx, ws)
      await insertProject(tx, ws)
      await insertProject(tx, ws)
      const repo = createProjectRepository(tx)
      const withActivity = await repo.findByWorkspaceWithActivity(ws)
      expect(withActivity.map((row) => row.project)).toEqual(await repo.findByWorkspace(ws))
    })
  })
})
