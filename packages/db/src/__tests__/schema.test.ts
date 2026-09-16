import { describe, expect, it } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import * as schema from '../schema/index.js'

/** docs/ARCHITECTURE.md §19 のテーブル一覧。ここに無いテーブルを作ってはいけない。 */
const EXPECTED_TABLES = [
  'workspaces',
  'projects',
  'media_assets',
  'characters',
  'character_identity_images',
  'character_looks',
  'character_look_images',
  'brand_assets',
  'locations',
  'motion_templates',
  'music_tracks',
  'music_analyses',
  'scripts',
  'script_versions',
  'sequences',
  'shots',
  'shot_characters',
  'shot_references',
  'transitions',
  'timeline_clips',
  'generation_jobs',
  'takes',
  'review_runs',
  'review_findings',
  'render_jobs',
] as const

const definedTableNames = (): string[] =>
  Object.values(schema)
    .filter((v) => typeof v === 'object' && v !== null && Symbol.for('drizzle:Name') in v)
    .map((t) => getTableName(t as Parameters<typeof getTableName>[0]))

describe('schema', () => {
  it('ARCHITECTURE.md §19 の全テーブルが定義されている', () => {
    const names = definedTableNames()
    for (const expected of EXPECTED_TABLES) expect(names).toContain(expected)
  })

  it('§19 に無いテーブルを定義していない', () => {
    const names = definedTableNames().sort()
    expect(names).toEqual([...EXPECTED_TABLES].sort())
  })

  it('テーブル名は snake_case の複数形', () => {
    for (const name of definedTableNames()) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*s$/)
    }
  })

  it('主キーは text（ULID）で UUID 型を使わない', () => {
    for (const table of [schema.projects, schema.shots, schema.takes, schema.mediaAssets]) {
      const { id } = getTableColumns(table)
      expect(id.primary).toBe(true)
      expect(id.getSQLType()).toBe('text')
    }
  })

  it('時間列は double precision の秒', () => {
    const shot = getTableColumns(schema.shots)
    expect(shot.startSec.getSQLType()).toBe('double precision')
    expect(shot.durationSec.getSQLType()).toBe('double precision')
    expect(shot.sourceInSec.getSQLType()).toBe('double precision')
    const clip = getTableColumns(schema.timelineClips)
    expect(clip.startSec.getSQLType()).toBe('double precision')
  })

  it('タイムスタンプ列は timestamp with time zone', () => {
    const { createdAt, updatedAt, deletedAt } = getTableColumns(schema.projects)
    for (const col of [createdAt, updatedAt, deletedAt]) {
      expect(col.getSQLType()).toBe('timestamp with time zone')
    }
  })

  it('takes は追記のみ: deleted_at を持たない', () => {
    expect('deletedAt' in getTableColumns(schema.takes)).toBe(false)
  })

  it('JSONB 列が jsonb 型で定義されている', () => {
    expect(getTableColumns(schema.takes).spec.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.takes).providerParams.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.renderJobs).timelineSnapshot.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.shots).sourceType.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.shots).camera.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.musicAnalyses).beats.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.musicAnalyses).energyCurve.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.timelineClips).content.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.generationJobs).routerDecision.getSQLType()).toBe('jsonb')
    expect(getTableColumns(schema.reviewFindings).evidence.getSQLType()).toBe('jsonb')
  })
})
