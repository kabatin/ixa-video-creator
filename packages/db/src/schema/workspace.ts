import { doublePrecision, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type { AspectRatio, Fps, ProjectStatus, Resolution } from '@ixa/domain'
import { AspectRatio as AspectRatioSchema, ProjectStatus as ProjectStatusSchema } from '@ixa/domain'
import { createdAt, deletedAt, seconds, ulidPk, ulidRef, updatedAt } from './columns.js'

/**
 * Workspace はすべてのエンティティのルート（DOMAIN.md §1）。
 * DOMAIN.md に型定義は無いため、ID と名前のみを持つ最小構成にしている。
 */
export const workspaces = pgTable('workspaces', {
  id: ulidPk(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
})

/** DOMAIN.md §3 Project */
export const projects = pgTable(
  'projects',
  {
    id: ulidPk(),
    workspaceId: ulidRef('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),

    // 出力仕様（レンダリングと Provider 選択の制約になる）
    fps: integer('fps').$type<Fps>().notNull(),
    resolution: jsonb('resolution').$type<Resolution>().notNull(),
    aspectRatio: text('aspect_ratio', { enum: AspectRatioSchema.options }).$type<AspectRatio>().notNull(),

    // 制作制約
    durationSec: seconds('duration_sec'),
    budgetUsd: doublePrecision('budget_usd'),
    styleGuide: text('style_guide').notNull().default(''),

    status: text('status', { enum: ProjectStatusSchema.options }).$type<ProjectStatus>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('projects_workspace_id_idx').on(t.workspaceId)],
)
