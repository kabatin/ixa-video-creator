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

/**
 * 変換関数が写している列名。
 *
 * 本体が式のもの（`=> Schema.parse({...})`）と、検査を挟んでから返すもの
 * （`=> { ...; return Schema.parse({...}) }`）の両方を拾う。
 * 名前は `shotRowToDomain` も `rowToDomain` も拾う。小文字始まりを拾えず、変更の履歴のリポジトリが
 * 黙って読み飛ばされていた（2026-10-02、列 `clip_entries` を足したのに落ちなかった）。
 * 片方しか拾えないと、本体の書き方を変えただけで**検査が黙ってスキップされる**。
 */
const mappedColumns = (source: string): Set<string> | null => {
  const match =
    /[Rr]owToDomain = \(row: \w+\): \w+ =>[\s\S]*?\w+\.parse\(\{(.*?)\n\s*\}\)/s.exec(source)
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

/** スキーマのファイルの中身すべて。テーブルの定義を名前から探す。 */
const SCHEMA_SOURCES = readdirSync(SCHEMA_DIR)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(SCHEMA_DIR, name), 'utf8'))

/** ドメインに存在しない、DB 内部だけの列。写さないのが正しい。 */
const INTERNAL_COLUMNS = new Set(['deletedAt'])

/**
 * そのリポジトリだけ写さない列。全体の例外に入れると、ほかの表で写し忘れても気づけなくなるので分ける。
 * - 作品の音の設定（ADR-0038）: 行が無い作品は既定を返すので、更新した時刻は Domain に持たない
 * - API に入る鍵（ADR-0046）: **鍵のハッシュは Domain に出さない**（Domain の鍵は API の応答と画面に流れる）。
 *   引くときは `findByHash` がハッシュで探すので、写さなくても困らない
 */
const INTERNAL_COLUMNS_BY_FILE: Readonly<Record<string, readonly string[]>> = {
  'project-audio-settings-repository.ts': ['updatedAt'],
  'access-token-repository.ts': ['tokenHash'],
}

/**
 * 変換関数を必ず見つけられること自体を検査する対象。
 *
 * 見つからないリポジトリは黙って読み飛ばす作りなので、
 * 「検査した結果 OK」と「そもそも検査していない」が区別できない（L-015）。
 * 少なくともこの一覧は、いつでも実際に検査されていなければならない。
 */
const MUST_BE_INSPECTED = [
  'generation-job-repository.ts',
  'take-repository.ts',
  'media-asset-repository.ts',
  'shot-repository.ts',
  'project-repository.ts',
  'edit-batch-repository.ts',
  'voice-profile-repository.ts',
  'narration-line-repository.ts',
  'narration-take-repository.ts',
  'voice-job-repository.ts',
  'project-audio-settings-repository.ts',
] as const

describe('row → domain 変換が列を落としていない', () => {
  const files = readdirSync(REPOSITORY_DIR).filter((f) => f.endsWith('-repository.ts'))

  it('検査対象のリポジトリが存在する', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(MUST_BE_INSPECTED)('%s の変換関数を見つけられる', (file) => {
    const source = readFileSync(join(REPOSITORY_DIR, file), 'utf8')
    expect(mappedColumns(source), `${file} の変換関数を認識できていません`).not.toBeNull()
  })

  for (const file of files) {
    it(`${file} が列を写し忘れていない`, () => {
      const source = readFileSync(join(REPOSITORY_DIR, file), 'utf8')
      const mapped = mappedColumns(source)
      if (mapped === null) return // 変換関数を持たないリポジトリ

      const tableMatch = /\.from\((\w+)\)/.exec(source)
      // 変換関数があるのにテーブルを突き止められないなら、**黙って通さず落とす**（L-015）。
      expect(tableMatch?.[1], `${file} のテーブルを見つけられません`).toBeDefined()
      if (!tableMatch?.[1]) return

      /**
       * テーブルを定義しているスキーマのファイルを、名前から探す。以前は最初の import を読んでいて、
       * 別のテーブル（review は generation）を読んだり、ハイフン入りの名前（edit-batch）を拾えなかったりして、
       * 黙って読み飛ばしていた（2026-10-02、列 `clip_entries` を足したのに落ちなかった）。
       */
      const schemaSource = SCHEMA_SOURCES.find((candidate) =>
        candidate.includes(`export const ${tableMatch[1] ?? ''} = pgTable`),
      )
      expect(schemaSource, `${file} のテーブル ${tableMatch[1]} を定義したスキーマが見つかりません`).toBeDefined()
      if (schemaSource === undefined) return
      const columns = tableColumns(schemaSource, tableMatch[1])
      expect(columns, `${file} のテーブル ${tableMatch[1]} の列を読めません`).not.toBeNull()
      if (columns === null) return

      const internal = new Set([...INTERNAL_COLUMNS, ...(INTERNAL_COLUMNS_BY_FILE[file] ?? [])])
      const missing = [...columns].filter((c) => !mapped.has(c) && !internal.has(c))
      expect(missing, `${file} が写していない列: ${missing.join(', ')}`).toEqual([])
    })
  }
})
