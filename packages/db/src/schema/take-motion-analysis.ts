import { boolean, doublePrecision, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import {
  MotionAnalysisStatus as MotionAnalysisStatusSchema,
  type MotionAnalysisStatus,
  type MotionEvent,
  type MotionOnset,
} from '@ixa/domain'
import { createdAt, ulidPk, ulidRef } from './columns.js'
import { takes } from './generation.js'

/**
 * Take の動きの分析（ADR-0054）。★ 追記のみ。作り直しは新しい行で、いちばん新しい行が今の結果。
 * 時刻はすべて Take の秒（タイムラインの秒は読むときに Shot から直す）。
 */
export const takeMotionAnalyses = pgTable(
  'take_motion_analyses',
  {
    id: ulidPk(),
    takeId: ulidRef('take_id')
      .notNull()
      .references(() => takes.id, { onDelete: 'cascade' }),
    /** 解析器の版（'motion-v1'）。同じ版で成功していれば作り直さない。 */
    analyzerVersion: text('analyzer_version').notNull(),
    status: text('status', { enum: MotionAnalysisStatusSchema.options }).$type<MotionAnalysisStatus>().notNull(),
    energyHopSec: doublePrecision('energy_hop_sec').notNull(),
    /** 隣のコマとの差の平均（0〜1）。 */
    energy: doublePrecision('energy').array().$type<number[]>().notNull().default([]),
    onsets: jsonb('onsets').$type<MotionOnset[]>().notNull().default([]),
    events: jsonb('events').$type<MotionEvent[]>().notNull().default([]),
    /** AI（Claude）がコマを見て判断したか。 */
    visionUsed: boolean('vision_used').notNull(),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    /** 失敗の理由（画面に出せる日本語）。URL や例外の本文は入れない。 */
    failureMessage: text('failure_message'),
    createdAt: createdAt(),
  },
  (t) => [index('take_motion_analyses_take_id_idx').on(t.takeId)],
)
