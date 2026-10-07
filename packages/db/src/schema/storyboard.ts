import { doublePrecision, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import type { StoryboardDraftCamera, StoryboardDraftRun } from '@ixa/domain'
import { createdAt, timestampTz, ulidPk, ulidRef } from './columns.js'
import { projects } from './workspace.js'
import { shots } from './shot.js'

/**
 * 絵コンテの下書き（PHASE 6.3）。形は `review_runs` / `review_findings` に合わせてある。
 *
 * **下書きは Shot を書き換えない。** 本制作の 68 Shot のうち 28 件は既に Take を採用済みで、
 * 説明が黙って変わると、生成済みの Take と食い違ったまま誰も気付かない。
 * 案はここに溜め、人が Shot ごとに採否を決める。
 */
export const storyboardDraftRuns = pgTable(
  'storyboard_draft_runs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 使った口の名前（`claude-cli` / `stub` など）。質の違いを後から切り分けるために残す。 */
    drafter: text('drafter').notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .$type<StoryboardDraftRun['status']>()
      .notNull(),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    error: jsonb('error').$type<NonNullable<StoryboardDraftRun['error']>>(),
    createdAt: createdAt(),
  },
  (t) => [index('storyboard_draft_runs_project_id_idx').on(t.projectId)],
)

/**
 * Shot 1 件ぶんの案。
 *
 * ★ **中身は追記のみ。** このテーブルへの UPDATE は `adopted_at` の 1 列に限る。
 *   `description` / `mood` / `reason` を書き換えると、「人が見て採用したもの」と
 *   「後から変わったもの」の区別が消える（Take と同じ考え方。ADR-0003）。
 *   作り直すなら新しい run を作る。
 *
 * `reason`（なぜこの絵か）は **NOT NULL**。68 件の採否を人が判断するには、
 * 案そのものだけでは足りない。
 *
 * 1 回の run で同じ Shot に 2 つの案を作らない（一意制約で担保する）。
 * 2 つあると、どちらを採用したのかが `adopted_at` だけでは読めなくなる。
 */
export const storyboardDraftItems = pgTable(
  'storyboard_draft_items',
  {
    id: ulidPk(),
    runId: ulidRef('run_id')
      .notNull()
      .references(() => storyboardDraftRuns.id, { onDelete: 'cascade' }),
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    mood: text('mood'),
    reason: text('reason').notNull(),
    /**
     * カメラの案（ADR-0043）。**NULL は「カメラの提案なし」**（採用してもカメラを触らない）。
     * 決められた項目だけが入る部分的な値（`StoryboardDraftCamera`）。
     */
    camera: jsonb('camera').$type<StoryboardDraftCamera>(),
    /** 採用した時刻。**NULL は「まだ決めていない」**（「不採用」ではない）。 */
    adoptedAt: timestampTz('adopted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('storyboard_draft_items_run_id_idx').on(t.runId),
    index('storyboard_draft_items_shot_id_idx').on(t.shotId),
    uniqueIndex('storyboard_draft_items_run_shot_uidx').on(t.runId, t.shotId),
  ],
)
