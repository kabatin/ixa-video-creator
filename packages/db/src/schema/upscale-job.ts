import { doublePrecision, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import {
  UpscaleJobStatus as UpscaleJobStatusSchema,
  type UpscaleJobError,
  type UpscaleJobStatus,
} from '@ixa/domain'
import { timestampTz, ulidPk, ulidRef } from './columns.js'
import { shots } from './shot.js'
import { takes } from './generation.js'
import { projects } from './workspace.js'

/**
 * 出来上がった Take の**解像度を上げる**ジョブ（ADR-0044 / FlashVSR）。
 *
 * **`generation_jobs` と分けてある。** あちらは「仕様から作る」ための表で、worker は行から仕様を
 * 組み直して `spec_hash` を突き合わせる（L-012）。**こちらには組み直す仕様が無い**（入力は
 * 出来上がった動画そのもの）。相乗りさせるとその突き合わせに例外が要るので、仕様を持たない生成の
 * 前例（`image_generation_jobs`）に倣って別の表にした。
 *
 * ★ 追記のみ。更新は状態の遷移（queued → running → succeeded / failed / cancelled）と、
 *   そのとき決まる列だけ。元の Take も、出来た Take も消さない。
 */
export const upscaleJobs = pgTable(
  'upscale_jobs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    /** 元にする Take。**これが入力そのもの。** */
    sourceTakeId: ulidRef('source_take_id')
      .notNull()
      .references(() => takes.id, { onDelete: 'cascade' }),
    status: text('status', { enum: UpscaleJobStatusSchema.options })
      .$type<UpscaleJobStatus>()
      .notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    /** 出来上がった Take。成功したときだけ。**成果物は素材ではなく Take。** */
    takeId: ulidRef('take_id').references(() => takes.id),
    /** 生成先のジョブ ID。問い合わせと取消に要る（`generation_jobs` と同じ役目）。 */
    providerJobRef: text('provider_job_ref'),
    error: jsonb('error').$type<UpscaleJobError>(),
    /**
     * 生成先が投入時に返した見込み（秒）。**走っている間の「あと何分」はこれを正とする。**
     * 返さないサーバ・古い版では null。
     */
    estimateSeconds: doublePrecision('estimate_seconds'),
    /** 再現用の記録（workflow 名・生成先のジョブ ID など）。**動画の中身は入れない。** */
    providerRecord: jsonb('provider_record').$type<Record<string, unknown>>(),
    queuedAt: timestampTz('queued_at').notNull().defaultNow(),
    startedAt: timestampTz('started_at'),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [
    index('upscale_jobs_shot_id_idx').on(t.shotId),
    index('upscale_jobs_source_take_id_idx').on(t.sourceTakeId),
    index('upscale_jobs_project_status_idx').on(t.projectId, t.status),
  ],
)
