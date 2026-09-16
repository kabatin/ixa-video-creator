import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * row → domain 変換で列を写し忘れていないかを検査する。
 *
 * **なぜテストが必要か**: ドメインのスキーマが `.default(null)` を持つ列は、
 * 変換で写し忘れても zod が既定値で埋めるため**型エラーにならない**。
 * DB には値が入っているのに、アプリからは常に既定値に見える。
 * 実際に `lastFrameAssetId` と `volume` の 2 列でこれが起きた（2026-09-16）。
 *
 * 静かに壊れる種類のバグなので、構造として検出する。
 */
const REPOSITORY_DIR = join(import.meta.dirname, '..', 'repositories')
const SCHEMA_DIR = join(import.meta.dirname, '..', 'schema')

/** 変換関数が写している列名。 */
const mappedColumns = (source: string): Set<string> | null => {
  const match = /RowToDomain = \(row: \w+\): \w+ =>\s*\w+\.parse\(\{(.*?)\n\s*\}\)/s.exec(source)
  if (!match?.[1]) return null
  return new Set([...match[1].matchAll(/(\w+):\s*row\./g)].map((m) => m[1] as string))
}

/** テーブル定義が持つ列名。 */
const tableColumns = (schemaSource: string, tableName: string): Set<string> | null => {
  const pattern = new RegExp(
    `export const ${tableName} = pgTable\\(\\s*'[^']+',\\s*\\{(.*?)\\n\\s*\\}`,
    's',
  )
  const match = pattern.exec(schemaSource)
  if (!match?.[1]) return null
  return new Set([...match[1].matchAll(/^\s*(\w+):\s*\w+\(/gm)].map((m) => m[1] as string))
}

/** ドメインに存在しない、DB 内部だけの列。写さないのが正しい。 */
const INTERNAL_COLUMNS = new Set(['deletedAt'])

describe('row → domain 変換が列を落としていない', () => {
  const files = readdirSync(REPOSITORY_DIR).filter((f) => f.endsWith('-repository.ts'))

  it('検査対象のリポジトリが存在する', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const file of files) {
    it(`${file} が列を写し忘れていない`, () => {
      const source = readFileSync(join(REPOSITORY_DIR, file), 'utf8')
      const mapped = mappedColumns(source)
      if (mapped === null) return // 変換関数を持たないリポジトリ

      const schemaMatch = /from '\.\.\/schema\/(\w+)\.js'/.exec(source)
      const tableMatch = /\.from\((\w+)\)/.exec(source)
      if (!schemaMatch?.[1] || !tableMatch?.[1]) return

      const schemaSource = readFileSync(join(SCHEMA_DIR, `${schemaMatch[1]}.ts`), 'utf8')
      const columns = tableColumns(schemaSource, tableMatch[1])
      if (columns === null) return

      const missing = [...columns].filter((c) => !mapped.has(c) && !INTERNAL_COLUMNS.has(c))
      expect(missing, `${file} が写していない列: ${missing.join(', ')}`).toEqual([])
    })
  }
})
