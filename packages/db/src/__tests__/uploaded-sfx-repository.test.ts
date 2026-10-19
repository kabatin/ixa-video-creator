import { getTableConfig } from 'drizzle-orm/pg-core'
import { MediaAssetId, ProjectId, UploadedSfxId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { uploadedSfxRowToDomain, type UploadedSfxRow } from '../repositories/uploaded-sfx-repository.js'
import { uploadedSfx } from '../schema/sfx.js'

/** 手元のファイルから取り込んだ効果音（ADR-0056）の行 → Domain。壊れた行を黙って読み替えない。 */
describe('uploaded_sfx', () => {
  const row: UploadedSfxRow = {
    id: newId(UploadedSfxId),
    projectId: newId(ProjectId),
    mediaAssetId: newId(MediaAssetId),
    title: 'ドアの音',
    createdAt: new Date('2026-10-19T00:00:00Z'),
    deletedAt: null,
  }

  it('行を取り込んだ効果音にする', () => {
    expect(uploadedSfxRowToDomain(row)).toEqual({
      id: row.id,
      projectId: row.projectId,
      mediaAssetId: row.mediaAssetId,
      title: 'ドアの音',
      createdAt: row.createdAt,
    })
  })

  it('名前が空・素材の ID が壊れた行は失敗する', () => {
    expect(() => uploadedSfxRowToDomain({ ...row, title: '' })).toThrow()
    expect(() => uploadedSfxRowToDomain({ ...row, mediaAssetId: 'x' })).toThrow()
  })

  it('作品と素材を外部キーで指す（素材は消させない）', () => {
    const { foreignKeys } = getTableConfig(uploadedSfx)
    expect(
      foreignKeys.map((fk) => [fk.reference().columns.map((c) => c.name).join(), fk.onDelete]).sort(),
    ).toEqual([
      ['media_asset_id', 'restrict'],
      ['project_id', 'cascade'],
    ])
  })
})
