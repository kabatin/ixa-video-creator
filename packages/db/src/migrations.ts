import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { z } from 'zod'
import type { DbClient, DbExecutor } from './client.js'

/**
 * DB の更新（migration）の点検と適用（ADR-0063。`pnpm ixa setup / doctor / update` が使う）。
 *
 * 当てたかどうかは drizzle の決め方に合わせる：`drizzle.__drizzle_migrations` の最後の `created_at`
 * より `_journal.json` の `when` が新しいものが「まだ」。drizzle-kit migrate と drizzle-orm の
 * migrator は同じ表を使うので、どちらで当てても同じ答えになる。
 */

/** このパッケージの `drizzle/`（SQL と `meta/_journal.json`）。 */
export const migrationsFolder = path.resolve(import.meta.dirname, '../drizzle')

export const MigrationJournal = z.object({
  entries: z.array(z.object({ idx: z.number().int(), when: z.number(), tag: z.string().min(1) })),
})
export type MigrationJournal = z.infer<typeof MigrationJournal>

/** 最後に当てた時刻（`created_at`）から、まだ当てていない更新の名前を古い順に返す（純粋）。 */
export const pendingFromJournal = (journal: MigrationJournal, lastAppliedAt: number | null): readonly string[] =>
  journal.entries
    .filter((entry) => lastAppliedAt === null || entry.when > lastAppliedAt)
    .toSorted((a, b) => a.idx - b.idx)
    .map((entry) => entry.tag)

/** `_journal.json` を読んで検証する。形が違えば投げる（黙って 0 本にしない）。 */
export const readMigrationJournal = async (folder: string = migrationsFolder): Promise<MigrationJournal> => {
  const file = path.join(folder, 'meta', '_journal.json')
  try {
    return MigrationJournal.parse(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    throw new Error(`DB の更新の一覧（${file}）を読めませんでした: ${String(error)}`, { cause: error })
  }
}

const LastApplied = z.object({ last: z.union([z.string(), z.number()]).nullable() })

/** 最後に当てた更新の時刻。表がまだ無ければ（1 本も当てていない）null。 */
const lastAppliedAt = async (db: DbExecutor): Promise<number | null> => {
  const exists = await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`)
  if (exists[0]?.['present'] !== true) return null
  const rows = await db.execute(sql`select max(created_at) as last from drizzle.__drizzle_migrations`)
  const { last } = LastApplied.parse(rows[0])
  return last === null ? null : Number(last)
}

/** まだ当てていない DB の更新の名前（古い順）。 */
export const pendingMigrations = async (db: DbExecutor, journal: MigrationJournal): Promise<readonly string[]> =>
  pendingFromJournal(journal, await lastAppliedAt(db))

/** まだ当てていない更新を当てる（drizzle-kit migrate と同じ表・同じ順番）。 */
export const applyMigrations = async (db: DbClient, folder: string = migrationsFolder): Promise<void> => {
  try {
    await migrate(db, { migrationsFolder: folder })
  } catch (error) {
    throw new Error(`DB の更新に失敗しました: ${String(error)}`, { cause: error })
  }
}
