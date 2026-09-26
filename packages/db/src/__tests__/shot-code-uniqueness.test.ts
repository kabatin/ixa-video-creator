import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { shots } from '../schema/shot.js'

/**
 * Shot のコードの一意は**生きている行だけ**（2026-09-26）。
 *
 * 以前は `(project_id, code)` の一意が論理削除した行まで数えていた。Shot を消して区切りから
 * 作り直すと、消したはずの `CUT-01` とぶつかって 500 になった（一括削除を足して実機で踏んだ）。
 * 消した Shot のコードは再び使えてよい。
 */
describe('shots_project_id_code_uidx', () => {
  const index = getTableConfig(shots).indexes.find(
    (candidate) => candidate.config.name === 'shots_project_id_code_uidx',
  )

  it('一意のインデックスがある', () => {
    expect(index?.config.unique).toBe(true)
  })

  it('論理削除した行を数えない（deleted_at is null の部分インデックス）', () => {
    const where = index?.config.where
    expect(where).toBeDefined()
    if (where === undefined) return
    expect(new PgDialect().sqlToQuery(where).sql).toMatch(/deleted_at.*is null/i)
  })
})
