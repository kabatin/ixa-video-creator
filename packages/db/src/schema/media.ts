import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { MediaKind, MediaOrigin, MediaProbe } from '@ixa/domain'
import { MediaKind as MediaKindSchema } from '@ixa/domain'
import { createdAt, deletedAt, ulidPk, ulidRef } from './columns.js'
import { projects, workspaces } from './workspace.js'

/**
 * DOMAIN.md §4 MediaAsset — すべてのファイルの唯一の実体。
 * 署名付き URL は保存しない（storage_key から都度発行する。CLAUDE.md 規約 7）。
 * origin は判別共用体なので JSONB。参照先（take / render_job）への FK は張らない
 * （生成物の出自は履歴であり、参照先が消えても残す）。
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: ulidPk(),
    workspaceId: ulidRef('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** NULL = ワークスペース共有のライブラリ資産 */
    projectId: ulidRef('project_id').references(() => projects.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: MediaKindSchema.options }).$type<MediaKind>().notNull(),

    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    bytes: integer('bytes').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),

    probe: jsonb('probe').$type<MediaProbe>(),
    proxyKey: text('proxy_key'),
    thumbnailKey: text('thumbnail_key'),
    posterKeys: text('poster_keys').array().notNull().default([]),

    origin: jsonb('origin').$type<MediaOrigin>().notNull(),
    tags: text('tags').array().notNull().default([]),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    /** 重複排除。ソフトデリート済みは対象外にする（ARCHITECTURE.md §19）。 */
    uniqueIndex('media_assets_checksum_sha256_live_uidx')
      .on(t.checksumSha256)
      .where(sql`${t.deletedAt} IS NULL`),
    index('media_assets_workspace_id_idx').on(t.workspaceId),
    index('media_assets_project_id_idx').on(t.projectId),
  ],
)
