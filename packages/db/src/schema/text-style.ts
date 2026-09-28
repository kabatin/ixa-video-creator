import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import type { TextStyle } from '@ixa/domain'
import { createdAt, deletedAt, ulidPk, ulidRef, updatedAt } from './columns.js'
import { projects } from './workspace.js'

/**
 * 名前を付けて保存したテロップの見た目（ADR-0028）。プロジェクトごと。
 * テロップに当てると値を写す（テロップ側に値と `styleId` が残る）ので、描くときにここは引かない。
 */
export const textStyles = pgTable(
  'text_styles',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    style: jsonb('style').$type<TextStyle>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('text_styles_project_id_idx').on(t.projectId),
    // 名前の一意は生きている行だけ。消したスタイルの名前は付け直せてよい。
    uniqueIndex('text_styles_project_id_name_uidx').on(t.projectId, t.name).where(sql`${t.deletedAt} is null`),
  ],
)
