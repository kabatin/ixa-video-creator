import { doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type {
  GenerationJob, GenerationJobStatus, HumanVerdict, ProviderParams, ReviewStatus,
  RouterDecision, ShotGenerationSpec,
} from '@ixa/domain'
import {
  GenerationJobStatus as GenerationJobStatusSchema,
  HumanVerdict as HumanVerdictSchema,
  ReviewStatus as ReviewStatusSchema,
} from '@ixa/domain'
import { createdAt, deletedAt, timestampTz, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { shots } from './shot.js'

/** DOMAIN.md §10 GenerationJob。外部 Provider へのジョブ 1 回分。 */
export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: ulidPk(),
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    specHash: text('spec_hash').notNull(),
    /** ModelId | 'AUTO' */
    requestedModel: text('requested_model').$type<GenerationJob['requestedModel']>().notNull(),
    resolvedModel: text('resolved_model').$type<GenerationJob['resolvedModel']>(),
    routerDecision: jsonb('router_decision').$type<RouterDecision>(),
    status: text('status', { enum: GenerationJobStatusSchema.options })
      .$type<GenerationJobStatus>()
      .notNull(),
    attempt: integer('attempt').notNull().default(1),
    /** 外部ジョブ ID */
    providerJobRef: text('provider_job_ref'),
    error: jsonb('error').$type<NonNullable<GenerationJob['error']>>(),

    /**
     * 系譜。再生成で積まれたジョブだけが値を持つ（DOMAIN.md §10）。
     *
     * **ここが系譜の唯一の正である。** 以前はキューのジョブペイロードにしか無く、
     * 行を作ってからペイロードに積むまでの間に落とすと、親も理由も持たない Take が
     * 静かに確定していた。Take は Immutable（ADR-0003）なので後から埋められない。
     *
     * `ON DELETE SET NULL` と列の型は `takes` の同名列に合わせてある。
     * 親を消すと「理由はあるが親が無い」形になり、Take 側と同じ読み方ができる。
     */
    parentTakeId: ulidRef('parent_take_id').references((): AnyPgColumn => takes.id, {
      onDelete: 'set null',
    }),
    regenerationReason: text('regeneration_reason'),

    /**
     * レビューの指摘から人が選んだ直し（PHASE 6.1）。
     *
     * **ここが直しの唯一の正である。** キューのジョブデータは `.strict()` で ID しか
     * 運ばないため（`apps/worker/src/generation/job-data.ts`）、系譜と同じく行に置く。
     * worker は処理時に仕様を組み直す。直しが行に無いと同じ `specHash` を再現できず
     * `spec_drift` で落ちる。
     *
     * **`NOT NULL DEFAULT '[]'`。** 直しを添えなかったジョブにとって「無い」は
     * 分からない状態ではなく事実なので、`NULL` と空配列の 2 通りを作らない（lessons L-021）。
     */
    corrections: jsonb('corrections').$type<readonly string[]>().notNull().default([]),

    /**
     * 使うシード（ADR-0042 の「本番で作り直す」）。**直しと同じ理由でここに置く。**
     * worker は処理時に仕様を組み直すので、シードが行に無いと同じ `specHash` を
     * 再現できず `spec_drift` で落ちる（実際に落ちた。L-012 と同じ形）。
     *
     * **`NULL` は「Provider に任せる」。** 0 は正当なシードなので、0 と NULL を混ぜない。
     */
    seed: integer('seed'),

    queuedAt: timestampTz('queued_at').notNull().defaultNow(),
    startedAt: timestampTz('started_at'),
    /** 生成先が作り始めた時刻（送った後、生成先の中で順番を待つことがある）。 */
    providerStartedAt: timestampTz('provider_started_at'),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [
    index('generation_jobs_shot_id_idx').on(t.shotId),
    index('generation_jobs_status_idx').on(t.status),
  ],
)

/**
 * DOMAIN.md §10 Take — Immutable（ADR-0003）。
 *
 * ★ 追記のみ（APPEND-ONLY）。
 *   このテーブルへの UPDATE は `review_status` と `human_verdict` の 2 列に限定する。
 *   spec / provider_params / media_asset_id / cost_usd などは作成後に変更しない。
 *   「作り直し」は parent_take_id を持つ新しい行を INSERT する。
 *   DELETE もしない（deleted_at 列を持たないのは意図的）。
 *   リポジトリ実装は @ixa/domain の TAKE_MUTABLE_FIELDS / TakeUpdate を守ること。
 *   DB トリガでの強制は ADR-0003 で検討事項。
 */
export const takes = pgTable(
  'takes',
  {
    id: ulidPk(),
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    /** Shot 内の連番（1 始まり、表示用） */
    index: integer('index').notNull(),

    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),

    // 再現性のためのスナップショット（Immutable）
    spec: jsonb('spec').$type<ShotGenerationSpec>().notNull(),
    specHash: text('spec_hash').notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    /** 実際に Provider へ送った固有パラメータ */
    providerParams: jsonb('provider_params').$type<ProviderParams>().notNull(),
    seedUsed: integer('seed_used'),

    // 計測
    costUsd: doublePrecision('cost_usd').notNull(),
    generationTimeSec: doublePrecision('generation_time_sec').notNull(),

    // 系譜（自己参照）
    parentTakeId: ulidRef('parent_take_id').references((): AnyPgColumn => takes.id, {
      onDelete: 'set null',
    }),
    regenerationReason: text('regeneration_reason'),

    /**
     * 作品の複製で写した Take なら元の Take（作ったときに 1 度だけ書く）。費用・予算・作り直しの回数に数えない。
     * **外部キーは付けない。** 元を物理削除したときに null へ落ちると、複製が黙って「この作品で払った」ことになる。
     */
    copiedFromTakeId: ulidRef('copied_from_take_id'),

    // 作成後に変更してよいのはこの 2 列だけ
    reviewStatus: text('review_status', { enum: ReviewStatusSchema.options })
      .$type<ReviewStatus>()
      .notNull()
      .default('pending'),
    humanVerdict: text('human_verdict', { enum: HumanVerdictSchema.options })
      .$type<HumanVerdict>()
      .notNull()
      .default('unreviewed'),
    createdAt: createdAt(),
    /**
     * 制作者が「Take を消す」で見えなくした時刻（ADR-0003 追記）。**行も中身も消さない**（記録と費用は残る）。
     * 作成後に変えてよいのは上の 2 列とこの印だけ。
     */
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('takes_shot_id_index_uidx').on(t.shotId, t.index),
    index('takes_spec_hash_idx').on(t.specHash),
  ],
)
