import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import {
  SfxJobStatus as SfxJobStatusSchema,
  type MediaAssetId,
  type SfxJobError,
  type SfxJobSpec,
  type SfxJobStatus,
  type TimelineClipId,
} from '@ixa/domain'
import { createdAt, deletedAt, timestampTz, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { projects } from './workspace.js'

/**
 * 効果音を作るジョブ（ADR-0052）。★ 追記のみ（状態の遷移と、そのとき決まる列だけ更新する）。
 * できた音は素材（media_assets）とタイムラインのクリップ（timeline_clips）の側にあり、ここはその ID を持つだけ。
 * クリップは人が消せるので外部キーにしない（消えたクリップの ID が残っても読める）。
 */
export const sfxJobs = pgTable(
  'sfx_jobs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    model: text('model'),
    /** きっかけ（時刻・長さ・説明・音量）と本数・種。 */
    spec: jsonb('spec').$type<SfxJobSpec>().notNull(),
    status: text('status', { enum: SfxJobStatusSchema.options }).$type<SfxJobStatus>().notNull(),
    error: jsonb('error').$type<SfxJobError>(),
    /** 調べるための記録（生成先のジョブ・かかった時間）。鍵と URL は入れない。 */
    providerRecord: jsonb('provider_record').$type<Record<string, unknown>>(),
    /** できた音の素材（番号順）。成功するまで空。 */
    mediaAssetIds: jsonb('media_asset_ids').$type<MediaAssetId[]>().notNull().default([]),
    /** 効果音の段に置いたクリップ（1 本目）。 */
    timelineClipId: ulidRef('timeline_clip_id').$type<TimelineClipId>(),
    queuedAt: timestampTz('queued_at').notNull().defaultNow(),
    startedAt: timestampTz('started_at'),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [index('sfx_jobs_project_status_idx').on(t.projectId, t.status)],
)

/**
 * 手元のファイルから取り込んだ効果音（ADR-0056）。作った効果音（sfx_jobs）とは別に記す
 * （作っていない音に作り物のきっかけを書かない）。効果音の段には置かない候補で、素材ツリーから段へ置く。
 */
export const uploadedSfx = pgTable(
  'uploaded_sfx_sounds',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    /** ファイル名から拡張子を除いたもの。 */
    title: text('title').notNull(),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('uploaded_sfx_sounds_project_id_idx').on(t.projectId)],
)
