import { and, asc, eq, isNull } from 'drizzle-orm'
import type { CreateMusicTrackInput, MusicTrack, ProjectId } from '@ixa/domain'
import {
  CreateMusicTrackInput as CreateMusicTrackInputSchema,
  MusicTrack as MusicTrackSchema,
  MusicTrackId as MusicTrackIdSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { musicTracks } from '../schema/music.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type MusicTrackRow = typeof musicTracks.$inferSelect

/**
 * MusicTrack の読み書き。戻り値は必ず `@ixa/domain` の型。
 *
 * 音源そのものの尺は MusicTrack ではなく MediaAsset.probe が持つ。
 * タイムラインの尺を出すときは mediaAssetId から MediaAsset を引くこと
 * （ARCHITECTURE.md §15）。
 */
export type MusicTrackRepository = {
  /** 投入順（ULID の昇順 = 時系列）。ソフトデリート済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<MusicTrack[]>
  create(input: CreateMusicTrackInput): Promise<MusicTrack>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const musicTrackRowToDomain = (row: MusicTrackRow): MusicTrack =>
  MusicTrackSchema.parse({
    id: row.id,
    projectId: row.projectId,
    mediaAssetId: row.mediaAssetId,
    title: row.title,
    isMaster: row.isMaster,
    offsetSec: row.offsetSec,
  })

export const createMusicTrackRepository = (db: DbClient): MusicTrackRepository => ({
  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(musicTracks)
      .where(and(eq(musicTracks.projectId, projectId), isNull(musicTracks.deletedAt)))
      .orderBy(asc(musicTracks.id))
    return rows.map(musicTrackRowToDomain)
  },

  async create(input) {
    const validated = CreateMusicTrackInputSchema.parse(input)
    const rows = await db
      .insert(musicTracks)
      .values({ ...validated, id: newId(MusicTrackIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('music_tracks への INSERT が行を返しませんでした')
    return musicTrackRowToDomain(row)
  },
})
