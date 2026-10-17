import { getTableConfig } from 'drizzle-orm/pg-core'
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

/** `update().set().where().returning()` だけを持つ偽物。書いた中身を覚えて、そのまま行として返す。 */
const fakeUpdateDb = () => {
  const set = vi.fn((patch: Partial<ThumbnailRow>) => ({
    where: () => ({ returning: () => Promise.resolve([row(patch)]) }),
  }))
  return { db: { update: () => ({ set }) } as unknown as DbClient, set }
}

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
})
