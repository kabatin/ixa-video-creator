import { doublePrecision, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { DubJobStatus as DubJobStatusSchema, type DubJobError, type DubJobStatus, type DubParams } from '@ixa/domain'
import { createdAt, seconds, timestampTz, ulidPk, ulidRef } from './columns.js'
import { takes } from './generation.js'
import { mediaAssets } from './media.js'
import { shots } from './shot.js'
import { projects, workspaces } from './workspace.js'

/**
 * 声の差し替え（ADR-0062 段 5b）。
 *
 * - `dub_jobs`: 1 Shot の差し替えの仕事。★ 追記のみ。更新は状態の遷移とそのとき決まる列だけ（`upscale_jobs` と同じ）。
 * - `tts_clips`: 読み上げの保存。声・読み方・文が同じなら読み直さない（音量や置き方だけ変えても無料でやり直せる）。
 *   **ワークスペースごと**（別のワークスペースの読み上げは読まない）。素材が消されていたら読み直して付け替える。
 */
export const dubJobs = pgTable(
  'dub_jobs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    /** 元の Take（積んだときの採用中の Take）。 */
    sourceTakeId: ulidRef('source_take_id')
      .notNull()
      .references(() => takes.id, { onDelete: 'cascade' }),
    status: text('status', { enum: DubJobStatusSchema.options }).$type<DubJobStatus>().notNull(),
    /** 出来た Take。成功したときだけ。 */
    takeId: ulidRef('take_id').references(() => takes.id),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    error: jsonb('error').$type<DubJobError>(),
    /** 行ごとの記録（出来た Take の providerParams と同じもの）。成功したときだけ。 */
    record: jsonb('record').$type<DubParams>(),
    queuedAt: timestampTz('queued_at').notNull().defaultNow(),
    startedAt: timestampTz('started_at'),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [
    index('dub_jobs_shot_id_idx').on(t.shotId),
    index('dub_jobs_project_status_idx').on(t.projectId, t.status),
  ],
)

export const ttsClips = pgTable(
  'tts_clips',
  {
    id: ulidPk(),
    workspaceId: ulidRef('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** sha256(モデル・声・読み方の指示・文) の 16 進。鍵（API キー）は入れない。 */
    cacheKey: text('cache_key').notNull(),
    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    durationSec: seconds('duration_sec').notNull(),
    /** 読んだときに払った額（使い回したときは払わない）。 */
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tts_clips_workspace_cache_key_uidx').on(t.workspaceId, t.cacheKey)],
)
