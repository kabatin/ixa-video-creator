import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { ThumbnailStatus as ThumbnailStatusSchema, type ThumbnailSpec, type ThumbnailStatus } from '@ixa/domain'
import { createdAt, timestampTz, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { projects } from './workspace.js'

/**
 * YouTube のサムネイルの書き出し（ADR-0051）。押すたびに 1 行。
 *
 * ★ 追記のみ。更新は状態の遷移（queued → rendering → done / failed）と、そのとき決まる列だけ。
 * ★ `spec` に署名付き URL は入らない（背景はタイムラインの秒か素材の ID だけ。規約 7）。
 */
export const thumbnails = pgTable(
  'thumbnails',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    spec: jsonb('spec').$type<ThumbnailSpec>().notNull(),
    status: text('status', { enum: ThumbnailStatusSchema.options }).$type<ThumbnailStatus>().notNull(),
    /** できた JPEG。素材を消されたら null に戻す（記録は残す）。 */
    outputAssetId: ulidRef('output_asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    /** 書き出しフォルダに置く名前（頼んだときに決める）。 */
    fileName: text('file_name').notNull(),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [index('thumbnails_project_id_idx').on(t.projectId)],
)
