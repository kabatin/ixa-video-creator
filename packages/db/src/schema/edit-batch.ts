import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type {
  EditBatch,
  EditBatchAssetEdit,
  EditBatchClipEdit,
  EditBatchClipEntry,
  EditBatchEntry,
  EditBatchLineEntry,
  EditBatchMusicEntry,
  EditBatchProjectEntry,
  EditBatchShotEdit,
  EditBatchTransitionEdit,
} from '@ixa/domain'
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
    /** ナレーションの行の「変える前」（ADR-0038）。これまでの記録は空。 */
    lineEntries: jsonb('line_entries').$type<readonly EditBatchLineEntry[]>().notNull().default([]),
    /** 楽曲の「変える前」（曲を最後の Shot で切る。2026-10-19）。これまでの記録は空。 */
    musicEntries: jsonb('music_entries').$type<readonly EditBatchMusicEntry[]>().notNull().default([]),
    /** クリップ 1 件ずつの作る・直す・消す（変える前の丸ごとの控え。2026-10-19）。これまでの記録は空。 */
    clipEdits: jsonb('clip_edits').$type<readonly EditBatchClipEdit[]>().notNull().default([]),
    /** トランジションの置く・消す（消した物の丸ごとの控え。2026-10-19）。これまでの記録は空。 */
    transitionEdits: jsonb('transition_edits').$type<readonly EditBatchTransitionEdit[]>().notNull().default([]),
    /** Shot の作成・削除（ID だけ。Shot は論理削除で中身が残る。2026-10-19）。これまでの記録は空。 */
    shotEdits: jsonb('shot_edits').$type<readonly EditBatchShotEdit[]>().notNull().default([]),
    /** 作品の欄の「変える前」（変えた欄だけ。2026-10-19）。**NULL は作品を触っていない。** */
    projectEntry: jsonb('project_entry').$type<EditBatchProjectEntry>(),
    /** 素材の作る・直す・消す（作った・消したものは ID、直したものは変えた欄の変える前。2026-10-19）。これまでの記録は空。 */
    assetEdits: jsonb('asset_edits').$type<readonly EditBatchAssetEdit[]>().notNull().default([]),
    /** 取り消した時刻。**NULL は「まだ取り消していない」**（「取り消せない」ではない）。 */
    undoneAt: timestampTz('undone_at'),
    createdAt: createdAt(),
  },
  (t) => [index('shot_edit_batches_project_id_idx').on(t.projectId)],
)
