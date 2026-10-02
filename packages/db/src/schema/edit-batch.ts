import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type { EditBatch, EditBatchClipEntry, EditBatchEntry } from '@ixa/domain'
import { EditBatchKind as EditBatchKindSchema } from '@ixa/domain'
import { createdAt, timestampTz, ulidPk, ulidRef } from './columns.js'
import { projects } from './workspace.js'

/**
 * 一括で変えた記録と、その取り消し（横断 ROADMAP: Undo と履歴）。
 *
 * ★ **中身は追記のみ。** このテーブルへの UPDATE は `undone_at` の 1 列に限る。
 *   `entries` を書き換えると「取り消したら何が戻るのか」が変わってしまい、
 *   人が見た内容と実際に戻る内容が食い違う（Take・絵コンテの案と同じ・ADR-0003）。
 *
 * `entries` は Shot ごとの「変える前」。**変えた欄だけ**を持つので、
 * 取り消してもその後に人が直した無関係な欄は残る。
 */
export const shotEditBatches = pgTable(
  'shot_edit_batches',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: EditBatchKindSchema.options })
      .$type<EditBatch['kind']>()
      .notNull(),
    /** 人が読む見出し。履歴に並べる。 */
    summary: text('summary').notNull(),
    entries: jsonb('entries').$type<readonly EditBatchEntry[]>().notNull(),
    /**
     * テロップの「変える前」（見た目と、どのスタイルからか）。テロップの見た目のまとめ変更（`text_style`）で使う。
     * これまでの記録は空。テーブル名は Shot のままだが、取り消しの仕組みを 1 つにするためここに足す（2026-10-02）。
     */
    clipEntries: jsonb('clip_entries').$type<readonly EditBatchClipEntry[]>().notNull().default([]),
    /** 取り消した時刻。**NULL は「まだ取り消していない」**（「取り消せない」ではない）。 */
    undoneAt: timestampTz('undone_at'),
    createdAt: createdAt(),
  },
  (t) => [index('shot_edit_batches_project_id_idx').on(t.projectId)],
)
