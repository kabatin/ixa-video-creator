import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { textStyleRowToDomain, type TextStyleRow } from '../repositories/text-style-repository.js'
import { textStyles } from '../schema/text-style.js'

/** 保存したテロップの見た目（ADR-0028）。 */
describe('text_styles', () => {
  const index = getTableConfig(textStyles).indexes.find(
    (candidate) => candidate.config.name === 'text_styles_project_id_name_uidx',
  )

  it('名前はプロジェクトの中で一意（生きている行だけ）', () => {
    expect(index?.config.unique).toBe(true)
    const where = index?.config.where
    expect(where).toBeDefined()
    if (where === undefined) return
    expect(new PgDialect().sqlToQuery(where).sql).toMatch(/deleted_at.*is null/i)
  })

  const row = (style: unknown): TextStyleRow => ({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    name: '歌詞',
    style: style as TextStyleRow['style'],
    createdAt: new Date('2026-09-28T00:00:00Z'),
    updatedAt: new Date('2026-09-28T00:00:00Z'),
    deletedAt: null,
  })

  it('行を domain の型にする', () => {
    expect(textStyleRowToDomain(row({ color: '#FFD100' }))).toMatchObject({ name: '歌詞', style: { color: '#FFD100' } })
  })

  it('読めない見た目の行は通さない（黙って既定値に畳まない）', () => {
    expect(() => textStyleRowToDomain(row({ color: 'red' }))).toThrow()
  })
})
