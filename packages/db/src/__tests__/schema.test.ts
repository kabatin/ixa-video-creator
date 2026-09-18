import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import * as schema from '../schema/index.js'

/**
 * テーブル一覧の**正は `docs/ARCHITECTURE.md` §19 の 1 箇所だけ**。
 *
 * 以前はここに同じ一覧を書き写していた。2 つあると必ずズレ、
 * 「ドキュメントを直したのにテストが落ちる」「テストを直したのに
 * ドキュメントが古い」のどちらかが起きる（lessons L-016）。
 * 実際に `storyboard_draft_*` を足したとき、ドキュメントだけ直して落ちた。
 *
 * **読めなかったら空を返さず落とす。** 空で通すと、テーブルを何個足しても
 * 検査が「合格」に化ける（memory: skipped-checks-must-leave-a-trace）。
 */
const ARCHITECTURE_MD = fileURLToPath(
  new URL('../../../../docs/ARCHITECTURE.md', import.meta.url),
)

const readExpectedTables = (): readonly string[] => {
  const doc = readFileSync(ARCHITECTURE_MD, 'utf8')
  const section = doc.slice(doc.indexOf('## 19. Database'))
  const body = /```[a-z]*\n([\s\S]*?)```/.exec(section)?.[1]
  if (body === undefined) {
    throw new Error('ARCHITECTURE.md §19 のテーブル一覧（コードブロック）が見つかりません')
  }
  const names = body
    .split('\n')
    .map((line) => /^([a-z_]+)/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined)
  if (names.length === 0) {
    throw new Error('ARCHITECTURE.md §19 のテーブル一覧が空です')
  }
  return names
}

const EXPECTED_TABLES = readExpectedTables()

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
