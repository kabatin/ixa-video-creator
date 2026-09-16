import { and, desc, eq } from 'drizzle-orm'
import type { CreateMusicAnalysisInput, MusicAnalysis, MusicTrackId } from '@ixa/domain'
import {
  CreateMusicAnalysisInput as CreateMusicAnalysisInputSchema,
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { musicAnalyses } from '../schema/music.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type MusicAnalysisRow = typeof musicAnalyses.$inferSelect

/**
 * MusicAnalysis の読み書き。戻り値は必ず `@ixa/domain` の型。
 *
 * **追記のみ。** 解析結果を UPDATE するメソッドを足してはいけない。
 * 再解析は新しい行として積み、`analyzerVersion` で区別する（ADR-0009）。
 * 手動補正（`MANUAL_ANALYZER_VERSION`）も 1 つの解析器バージョンとして共存する。
 */
export type MusicAnalysisRepository = {
  /** 最新の 1 件。ULID の降順先頭＝直近に積まれた解析。無ければ null。 */
  findByTrack(musicTrackId: MusicTrackId): Promise<MusicAnalysis | null>
  /**
   * 指定した解析器バージョンの最新 1 件。
   * 「同じ解析器で解析済みか」「手動補正が入っているか」を
   * 全件読み込まずに判定するために分けている（冪等判定・ADR-0009 の手動優先）。
   */
  findByTrackAndVersion(
    musicTrackId: MusicTrackId,
    analyzerVersion: string,
  ): Promise<MusicAnalysis | null>
  create(input: CreateMusicAnalysisInput): Promise<MusicAnalysis>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const musicAnalysisRowToDomain = (row: MusicAnalysisRow): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: row.id,
    musicTrackId: row.musicTrackId,
    analyzerVersion: row.analyzerVersion,
    durationSec: row.durationSec,
    bpm: row.bpm,
    bpmConfidence: row.bpmConfidence,
    beats: row.beats,
    downbeats: row.downbeats,
    sections: row.sections,
    energyCurve: row.energyCurve,
    onsets: row.onsets,
    drops: row.drops,
    waveformPeaksKey: row.waveformPeaksKey,
    createdAt: row.createdAt,
  })

export const createMusicAnalysisRepository = (db: DbClient): MusicAnalysisRepository => ({
  async findByTrack(musicTrackId) {
    const rows = await db
      .select()
      .from(musicAnalyses)
      .where(eq(musicAnalyses.musicTrackId, musicTrackId))
      .orderBy(desc(musicAnalyses.id))
      .limit(1)
    const row = rows[0]
    return row ? musicAnalysisRowToDomain(row) : null
  },

  async findByTrackAndVersion(musicTrackId, analyzerVersion) {
    const rows = await db
      .select()
      .from(musicAnalyses)
      .where(
        and(
          eq(musicAnalyses.musicTrackId, musicTrackId),
          eq(musicAnalyses.analyzerVersion, analyzerVersion),
        ),
      )
      .orderBy(desc(musicAnalyses.id))
      .limit(1)
    const row = rows[0]
    return row ? musicAnalysisRowToDomain(row) : null
  },

  async create(input) {
    const validated = CreateMusicAnalysisInputSchema.parse(input)
    const rows = await db
      .insert(musicAnalyses)
      .values({
        ...validated,
        id: newId(MusicAnalysisIdSchema),
        createdAt: new Date(),
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('music_analyses への INSERT が行を返しませんでした')
    return musicAnalysisRowToDomain(row)
  },
})
