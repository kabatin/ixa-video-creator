import { doublePrecision, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * 全テーブル共通の列ヘルパ。
 * - 主キーは ULID を格納する text（UUID 型は使わない。ARCHITECTURE.md §19）
 * - 時間は double precision の「秒」（ミリ秒・フレームは保存しない。CLAUDE.md 規約 3）
 * - タイムスタンプ列は timestamp with time zone
 */
export const ulidPk = (name = 'id') => text(name).primaryKey()

export const ulidRef = (name: string) => text(name)

export const seconds = (name: string) => doublePrecision(name)

export const timestampTz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' })

export const createdAt = () => timestampTz('created_at').notNull().defaultNow()

export const updatedAt = () => timestampTz('updated_at').notNull().defaultNow()

/** ソフトデリート。NULL = 生存。制作物の履歴を消さない（ARCHITECTURE.md §19）。 */
export const deletedAt = () => timestampTz('deleted_at')
