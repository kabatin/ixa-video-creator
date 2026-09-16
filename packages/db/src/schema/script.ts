import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { ScriptVersion } from '@ixa/domain'
import { createdAt, deletedAt, ulidPk, ulidRef } from './columns.js'
import { projects } from './workspace.js'

/** DOMAIN.md §8 Script / ScriptVersion / Sequence */
export const scripts = pgTable(
  'scripts',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 循環参照（scripts ⇄ script_versions）のため AnyPgColumn で型を切る */
    currentVersionId: ulidRef('current_version_id').references(
      (): AnyPgColumn => scriptVersions.id,
      { onDelete: 'set null' },
    ),
    deletedAt: deletedAt(),
  },
  (t) => [index('scripts_project_id_idx').on(t.projectId)],
)

export const scriptVersions = pgTable(
  'script_versions',
  {
    id: ulidPk(),
    scriptId: ulidRef('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Markdown */
    content: text('content').notNull(),
    authoredBy: text('authored_by', { enum: ['human', 'ai'] })
      .$type<ScriptVersion['authoredBy']>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('script_versions_script_id_version_uidx').on(t.scriptId, t.version)],
)

export const sequences = pgTable(
  'sequences',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    name: text('name').notNull(),
    /** MusicSection との紐付け（任意） */
    musicSectionLabel: text('music_section_label'),
    notes: text('notes').notNull().default(''),
    deletedAt: deletedAt(),
  },
  (t) => [index('sequences_project_id_order_idx').on(t.projectId, t.order)],
)
