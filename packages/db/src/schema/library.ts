import { index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import type { BrandCategory, MediaAssetId } from '@ixa/domain'
import { BrandCategory as BrandCategorySchema } from '@ixa/domain'
import { deletedAt, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { workspaces } from './workspace.js'

/** DOMAIN.md §6 Asset Library: brand_assets / locations / motion_templates */
export const brandAssets = pgTable(
  'brand_assets',
  {
    id: ulidPk(),
    workspaceId: ulidRef('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    category: text('category', { enum: BrandCategorySchema.options }).$type<BrandCategory>().notNull(),
    name: text('name').notNull(),
    /** color / font は NULL のことがある */
    mediaAssetId: ulidRef('media_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    /** color なら '#FFD200' */
    value: text('value'),
    /** Brand Review が読む運用ルール */
    usageRule: text('usage_rule').notNull().default(''),
    deletedAt: deletedAt(),
  },
  (t) => [index('brand_assets_workspace_id_idx').on(t.workspaceId)],
)

export const locations = pgTable(
  'locations',
  {
    id: ulidPk(),
    workspaceId: ulidRef('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** 参照画像の MediaAssetId 配列。FK は張らない（配列列のため）。 */
    referenceAssetIds: text('reference_asset_ids').array().$type<MediaAssetId[]>().notNull().default([]),
    deletedAt: deletedAt(),
  },
  (t) => [index('locations_workspace_id_idx').on(t.workspaceId)],
)

export const motionTemplates = pgTable(
  'motion_templates',
  {
    id: ulidPk(),
    workspaceId: ulidRef('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Remotion composition id と 1:1。workspace 内で一意。 */
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** UI フォームと検証を自動生成する JSON Schema */
    paramsSchema: jsonb('params_schema').$type<Record<string, unknown>>().notNull(),
    previewAssetId: ulidRef('preview_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('motion_templates_workspace_id_key_uidx').on(t.workspaceId, t.key)],
)
