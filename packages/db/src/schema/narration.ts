import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import {
  VoiceJobKind as VoiceJobKindSchema,
  VoiceJobStatus as VoiceJobStatusSchema,
  VoiceToolId as VoiceToolIdSchema,
  type CharTime,
  type DuckingSettings,
  type NarrationTakeSource,
  type ReadingEntry,
  type TelopHighlightSettings,
  type VoiceJobError,
  type VoiceJobKind,
  type VoiceJobStatus,
  type VoiceSpec,
  type VoiceToolId,
  type VoiceTuning,
} from '@ixa/domain'
import { createdAt, deletedAt, seconds, timestampTz, ulidPk, ulidRef, updatedAt } from './columns.js'
import { mediaAssets } from './media.js'
import { textStyles } from './text-style.js'
import { projects } from './workspace.js'

/**
 * ナレーションと声（ADR-0038）。声（ナレーター・キャラクターの声）、原稿の行、行の声の Take、声のジョブ、
 * 作品ごとの音の設定（読み辞書・ダッキング）。
 */

/** 声。消しても行の記録が追えるよう論理削除。 */
export const voiceProfiles = pgTable(
  'voice_profiles',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tool: text('tool', { enum: VoiceToolIdSchema.options }).$type<VoiceToolId>().notNull(),
    model: text('model'),
    voiceName: text('voice_name').notNull(),
    styleNote: text('style_note').notNull().default(''),
    speed: doublePrecision('speed').notNull().default(1),
    volume: doublePrecision('volume').notNull().default(1),
    language: text('language').notNull().default('ja'),
    tuning: jsonb('tuning').$type<VoiceTuning>().notNull().default({}),
    textStyleId: ulidRef('text_style_id').references(() => textStyles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('voice_profiles_project_id_idx').on(t.projectId),
    // 名前の一意は生きている行だけ（消した声の名前は付け直せてよい）。
    uniqueIndex('voice_profiles_project_id_name_uidx').on(t.projectId, t.name).where(sql`${t.deletedAt} is null`),
  ],
)

/** 原稿の行。位置（秒）を自分で持つ。 */
export const narrationLines = pgTable(
  'narration_lines',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    order: integer('sort_order').notNull(),
    text: text('text').notNull(),
    reading: text('reading'),
    voiceProfileId: ulidRef('voice_profile_id').references(() => voiceProfiles.id, { onDelete: 'set null' }),
    direction: text('direction').notNull().default(''),
    startSec: seconds('start_sec'),
    /** 循環参照（narration_lines ⇄ narration_takes）のため AnyPgColumn で型を切る。 */
    selectedTakeId: ulidRef('selected_take_id').references((): AnyPgColumn => narrationTakes.id, { onDelete: 'set null' }),
    telop: boolean('telop').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('narration_lines_project_id_idx').on(t.projectId)],
)

/**
 * 行の声の Take。★ 追記のみ。音・読み・費用は作成後に変えない。
 * 後から変わってよいのは字の時刻（`char_times`。時刻の無い声に後から付ける）だけ。
 */
export const narrationTakes = pgTable(
  'narration_takes',
  {
    id: ulidPk(),
    lineId: ulidRef('line_id')
      .notNull()
      .references(() => narrationLines.id, { onDelete: 'cascade' }),
    index: integer('take_index').notNull(),
    source: jsonb('source').$type<NarrationTakeSource>().notNull(),
    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    inSec: seconds('in_sec').notNull(),
    outSec: seconds('out_sec').notNull(),
    spokenText: text('spoken_text').notNull(),
    displayText: text('display_text').notNull(),
    specHash: text('spec_hash'),
    charTimes: jsonb('char_times').$type<CharTime[]>(),
    loudnessLufs: doublePrecision('loudness_lufs'),
    peaks: jsonb('peaks').$type<number[]>(),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('narration_takes_line_id_take_index_uidx').on(t.lineId, t.index),
    index('narration_takes_spec_hash_idx').on(t.lineId, t.specHash),
  ],
)

/**
 * 声のジョブ。★ 追記のみ（状態の遷移と、そのとき決まる列だけ更新する）。
 * 画像のジョブと違い、**掛かった額を残す**（費用の表示と予算に入れる）。
 */
export const voiceJobs = pgTable(
  'voice_jobs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: VoiceJobKindSchema.options }).$type<VoiceJobKind>().notNull(),
    lineId: ulidRef('line_id').references(() => narrationLines.id, { onDelete: 'cascade' }),
    takeId: ulidRef('take_id').references(() => narrationTakes.id, { onDelete: 'cascade' }),
    voiceProfileId: ulidRef('voice_profile_id').references(() => voiceProfiles.id, { onDelete: 'set null' }),
    inputMediaAssetId: ulidRef('input_media_asset_id').references(() => mediaAssets.id),
    resultMediaAssetId: ulidRef('result_media_asset_id').references(() => mediaAssets.id),
    /** 録音を置く位置（文字起こしだけ）。 */
    placeAtSec: seconds('place_at_sec'),
    tool: text('tool').notNull(),
    model: text('model'),
    spec: jsonb('spec').$type<VoiceSpec>(),
    status: text('status', { enum: VoiceJobStatusSchema.options }).$type<VoiceJobStatus>().notNull(),
    costUsd: doublePrecision('cost_usd'),
    error: jsonb('error').$type<VoiceJobError>(),
    /** 調べるための記録（使った量・モデル）。鍵と原稿は入れない。 */
    providerRecord: jsonb('provider_record').$type<Record<string, unknown>>(),
    queuedAt: timestampTz('queued_at').notNull().defaultNow(),
    startedAt: timestampTz('started_at'),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [
    index('voice_jobs_project_status_idx').on(t.projectId, t.status),
    index('voice_jobs_line_id_idx').on(t.lineId),
  ],
)

/** 作品ごとの音の設定。行が無ければ既定（辞書は空・ダッキングはオンで中）。 */
export const projectAudioSettings = pgTable('project_audio_settings', {
  projectId: ulidRef('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  readingDictionary: jsonb('reading_dictionary').$type<ReadingEntry[]>().notNull().default([]),
  ducking: jsonb('ducking').$type<DuckingSettings>().notNull(),
  /** 話している字を強調するか（ADR-0038）。前からの行は強調しない。 */
  telopHighlight: jsonb('telop_highlight')
    .$type<TelopHighlightSettings>()
    .notNull()
    .default({ enabled: false, color: '#ffd400' }),
  updatedAt: updatedAt(),
})
