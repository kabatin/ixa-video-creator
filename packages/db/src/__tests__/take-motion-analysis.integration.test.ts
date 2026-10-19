import { MOTION_ANALYZER_VERSION, newId, TakeId, type CreateMotionAnalysisInput } from '@ixa/domain'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { createTakeMotionAnalysisRepository } from '../repositories/take-motion-analysis-repository.js'

/**
 * Take ごとの最新の成功の行（2026-10-19 のレビュー）。**実際の Postgres で** DISTINCT ON の並びを確かめる。
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

/** Take を 1 本作る（外部キーをたどって作品・Shot・素材も）。中身は使わないので最小の値。 */
const insertTake = async (tx: DbExecutor, suffix: string): Promise<TakeId> => {
  const ids = {
    ws: `01M5WS${suffix}00000000000000`.slice(0, 26),
    pj: `01M5PJ${suffix}00000000000000`.slice(0, 26),
  }
  const shotId = `01M5SH${suffix}00000000000000`.slice(0, 26)
  const assetId = `01M5MA${suffix}00000000000000`.slice(0, 26)
  const takeId = newId(TakeId)
  await tx.execute(
    sql`insert into workspaces (id, name) values (${ids.ws}, '結合テスト（巻き戻す）') on conflict do nothing`,
  )
  await tx.execute(sql`insert into projects (id, workspace_id, name, fps, resolution, aspect_ratio, status)
    values (${ids.pj}, ${ids.ws}, '結合テスト（巻き戻す）', 24, '{"width":1280,"height":720}'::jsonb, '16:9', 'production') on conflict do nothing`)
  await tx.execute(sql`insert into shots (id, project_id, "order", code, start_sec, duration_sec, camera, source_type, status)
    values (${shotId}, ${ids.pj}, 1000, ${`IT-${suffix}`}, 0, 4, '{}'::jsonb, '{"type":"t2v"}'::jsonb, 'draft')`)
  await tx.execute(sql`insert into media_assets (id, workspace_id, kind, storage_key, mime_type, bytes, checksum_sha256, origin)
    values (${assetId}, ${ids.ws}, 'video', 'k', 'video/mp4', 1, ${`it-${suffix}-${takeId}`}, '{"type":"upload"}'::jsonb)`)
  await tx.execute(sql`insert into takes (id, shot_id, index, media_asset_id, spec, spec_hash, provider_id, model_id, provider_params, cost_usd, generation_time_sec)
    values (${takeId}, ${shotId}, 1, ${assetId}, '{}'::jsonb, 'h', 'stub', 'stub', '{}'::jsonb, 0, 0)`)
  return takeId
}

const row = (
  takeId: TakeId,
  patch: Partial<CreateMotionAnalysisInput> = {},
): CreateMotionAnalysisInput => ({
  takeId,
  analyzerVersion: MOTION_ANALYZER_VERSION,
  status: 'succeeded',
  energyHopSec: 1 / 12,
  energy: [0, 0.1],
  onsets: [],
  events: [],
  visionUsed: true,
  costUsd: 0,
  failureMessage: null,
  ...patch,
})

describe.skipIf(url === undefined)('findLatestSucceededByTakes（実際の DB）', () => {
  it('同じ Take に版・行がいくつあっても、Take ごとに最新の成功の 1 行だけを返す', async () => {
    await inRolledBackTransaction(async (tx) => {
      const repo = createTakeMotionAnalysisRepository(tx)
      const a = await insertTake(tx, 'AAAA')
      const b = await insertTake(tx, 'BBBB')
      await repo.create(row(a, { analyzerVersion: 'motion-v1', costUsd: 1 }))
      const latestA = await repo.create(row(a, { costUsd: 2 }))
      // それより新しい失敗の行は「成功の最新」ではない。
      await repo.create(row(a, { status: 'failed', failureMessage: '失敗しました。', energy: [] }))
      const latestB = await repo.create(row(b, { costUsd: 3 }))

      const found = await repo.findLatestSucceededByTakes([a, b])
      expect([...found.keys()].sort()).toEqual([a, b].sort())
      expect(found.get(a)?.id).toBe(latestA.id)
      expect(found.get(b)?.id).toBe(latestB.id)
      expect(await repo.findLatestSucceededByTakes([])).toEqual(new Map())
    })
  })
})
