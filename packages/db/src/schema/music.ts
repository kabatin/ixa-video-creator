import { boolean, doublePrecision, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type { MusicAnalysis, MusicSection, Seconds } from '@ixa/domain'
import { createdAt, deletedAt, seconds, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { projects } from './workspace.js'

/** DOMAIN.md §7 MusicTrack */
export const musicTracks = pgTable(
  'music_tracks',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    mediaAssetId: ulidRef('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    /** プロジェクトの尺を決める 1 曲 */
    isMaster: boolean('is_master').notNull().default(false),
    /** タイムライン上の開始位置（秒） */
    offsetSec: seconds('offset_sec').notNull().default(0),
    deletedAt: deletedAt(),
  },
  (t) => [index('music_tracks_project_id_idx').on(t.projectId)],
)

/**
 * DOMAIN.md §7 MusicAnalysis。
 * beats / downbeats / sections / energy_curve は JSONB（ARCHITECTURE.md §19）。
 * 時間はすべて秒。
 */
export const musicAnalyses = pgTable(
  'music_analyses',
  {
    id: ulidPk(),
    musicTrackId: ulidRef('music_track_id')
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    /** 再解析の判定に使う（'librosa-v1' | 'manual'）。手動補正は常に優先（ADR-0009）。 */
    analyzerVersion: text('analyzer_version').notNull(),
    bpm: doublePrecision('bpm').notNull(),
    bpmConfidence: doublePrecision('bpm_confidence').notNull(),
    beats: jsonb('beats').$type<Seconds[]>().notNull(),
    downbeats: jsonb('downbeats').$type<Seconds[]>().notNull(),
    sections: jsonb('sections').$type<MusicSection[]>().notNull(),
    energyCurve: jsonb('energy_curve').$type<MusicAnalysis['energyCurve']>().notNull(),
    onsets: doublePrecision('onsets').array().$type<Seconds[]>().notNull().default([]),
    drops: doublePrecision('drops').array().$type<Seconds[]>().notNull().default([]),
    /** UI 波形描画用のピークデータ（ストレージ上のキー） */
    waveformPeaksKey: text('waveform_peaks_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('music_analyses_music_track_id_idx').on(t.musicTrackId)],
)
