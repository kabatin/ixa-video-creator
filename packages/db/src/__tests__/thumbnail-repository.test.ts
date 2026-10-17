import { getTableConfig } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { DbClient } from '../client.js'
import {
  createThumbnailRepository,
  thumbnailRowToDomain,
  type ThumbnailRow,
} from '../repositories/thumbnail-repository.js'
import { thumbnails } from '../schema/thumbnail.js'

/**
 * サムネイルの書き出し（ADR-0051）。実 DB には接続しない。行 → domain の変換と、
 * 状態と中身の食い違いを読む側・書く側の両方で止めることを確かめる。
 */

const ASSET = '01ARZ3NDEKTSV4RRFFQ69G5FAW'

const row = (patch: Partial<ThumbnailRow> = {}): ThumbnailRow => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  spec: {
    background: { kind: 'timeline_frame', atSec: 3.5 },
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
    title: '新曲',
    subtitle: null,
    layout: 'left',
    titleColor: '#ffffff',
    accentColor: '#ffcc00',
    font: 'gothic',
  },
  status: 'queued',
  outputAssetId: null,
  fileName: 'a サムネ 2026-10-17 10.00.00.jpg',
  error: null,
  createdAt: new Date('2026-10-17T01:00:00Z'),
  finishedAt: null,
  ...patch,
})

/**
 * `update().set().where().returning()` と `select().from().where()...` を持つ偽物。
 * `current` の行が今の DB。update の where は SQL に直して覚え、**状態の条件を本当に評価する**
 * （元の状態が許されていなければ 0 行。条件を外したら、このテストが落ちる）。
 */
const fakeDb = (current: ThumbnailRow = row(), selected: readonly ThumbnailRow[] = [current]) => {
  const wheres: string[] = []
  const set = vi.fn((patch: Partial<ThumbnailRow>) => ({
    where: (condition: SQL) => {
      const query = new PgDialect().sqlToQuery(condition)
      wheres.push(query.sql)
      const guarded = query.sql.includes('"status" in')
      const allowed = !guarded || query.params.includes(current.status)
      return { returning: () => Promise.resolve(allowed ? [row({ ...current, ...patch })] : []) }
    },
  }))
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve([...selected]),
    limit: () => Promise.resolve([current]),
  }
  return { db: { update: () => ({ set }), select: () => chain } as unknown as DbClient, set, wheres }
}
const fakeUpdateDb = () => fakeDb()

describe('thumbnails', () => {
  it('行を domain の型にする', () => {
    expect(thumbnailRowToDomain(row())).toMatchObject({ status: 'queued', spec: { title: '新曲' } })
    expect(thumbnailRowToDomain(row({ status: 'done', outputAssetId: ASSET })).outputAssetId).toBe(ASSET)
  })

  it('終わったのに JPEG が無い・失敗なのに理由が無い行は通さない', () => {
    expect(() => thumbnailRowToDomain(row({ status: 'done' }))).toThrow(/JPEG/)
    expect(() => thumbnailRowToDomain(row({ status: 'failed' }))).toThrow(/理由/)
  })

  it('仕様が壊れた行は通さない（題名が長すぎる）', () => {
    expect(() => thumbnailRowToDomain(row({ spec: { ...row().spec, title: 'あ'.repeat(41) } }))).toThrow()
  })

  it('プロジェクトごとに引ける索引がある', () => {
    expect(getTableConfig(thumbnails).indexes.map((index) => index.config.name)).toContain('thumbnails_project_id_idx')
  })

  it('終わったら JPEG と終わった時刻を書き、理由を消す', async () => {
    const { db, set } = fakeUpdateDb()
    const done = await createThumbnailRepository(db).markDone(row().id as never, ASSET as never)
    expect(done.status).toBe('done')
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'done', outputAssetId: ASSET, error: null }))
    expect(set.mock.calls[0]?.[0].finishedAt).toBeInstanceOf(Date)
  })

  it('失敗の理由が空なら書かずに止める', async () => {
    const { db, set } = fakeUpdateDb()
    await expect(createThumbnailRepository(db).markFailed(row().id as never, '')).rejects.toThrow()
    expect(set).not.toHaveBeenCalled()
  })

  it('終わった行は上書きしない（遅れて来た worker が failed を done にしない）', async () => {
    const failed = row({ status: 'failed', error: '描けませんでした', finishedAt: new Date() })
    const { db, wheres } = fakeDb(failed)
    const result = await createThumbnailRepository(db).markDone(failed.id as never, ASSET as never)
    expect(result.status).toBe('failed')
    expect(result.outputAssetId).toBeNull()
    expect(wheres[0]).toContain('"status" in')
  })

  it('done も failed で上書きしない', async () => {
    const done = row({ status: 'done', outputAssetId: ASSET, finishedAt: new Date() })
    const { db } = fakeDb(done)
    expect((await createThumbnailRepository(db).markFailed(done.id as never, '遅れた失敗')).status).toBe('done')
  })

  it('一覧は壊れた行を飛ばして知らせる（1 行で一覧とフォルダの同期を落とさない）', async () => {
    const broken = row({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ', status: 'done', outputAssetId: null })
    const onBrokenRow = vi.fn()
    const { db } = fakeDb(row(), [broken, row()])
    const list = await createThumbnailRepository(db, { onBrokenRow }).findByProject(row().projectId as never)
    expect(list.map((thumbnail) => thumbnail.id)).toEqual([row().id])
    expect(onBrokenRow).toHaveBeenCalledWith(broken.id, expect.stringContaining('JPEG'))
  })
})
