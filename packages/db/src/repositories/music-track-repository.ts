import { and, asc, eq, isNull } from 'drizzle-orm'
import type { CreateMusicTrackInput, MusicTrack, MusicTrackId, ProjectId } from '@ixa/domain'
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
  /** ソフトデリート済みは null。worker の音楽解析がジョブデータの ID から引く。 */
  findById(id: MusicTrackId): Promise<MusicTrack | null>
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
    volume: row.volume,
  })

export const createMusicTrackRepository = (db: DbClient): MusicTrackRepository => ({
  async findById(id) {
    const rows = await db
      .select()
      .from(musicTracks)
      .where(and(eq(musicTracks.id, id), isNull(musicTracks.deletedAt)))
      .limit(1)
    const row = rows[0]
    return row ? musicTrackRowToDomain(row) : null
  },

  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(musicTracks)
      .where(and(eq(musicTracks.projectId, projectId), isNull(musicTracks.deletedAt)))
      .orderBy(asc(musicTracks.id))
    return rows.map(musicTrackRowToDomain)
  },

  /**
   * **マスター音源は Project に 1 つだけ。**
   *
   * ミュージックビデオの尺を決めるのはマスター音源で、タイムラインの終端も
   * ビート吸着の基準もそこから引く。2 つあると `find(isMaster)` が最初の 1 つを
   * 勝手に選び、**どちらが採用されたか画面から分からない**。実データで実際に
   * 2 つになっていた。
   *
   * Look の既定（`character-look-repository.ts`）と同じ扱いにする。
   * 最初の 1 曲は必ずマスターにし、マスターとして足したら他を降格させる。
   * 拒否しないのは、「これをマスターにする」が自然な操作だから。
   */
  async create(input) {
    const validated = CreateMusicTrackInputSchema.parse(input)
    // 降格と INSERT を 1 トランザクションにまとめる。途中で失敗すると 0 個か 2 個になる。
    return db.transaction(async (tx) => {
      const siblings = await tx
        .select({ id: musicTracks.id })
        .from(musicTracks)
        .where(and(eq(musicTracks.projectId, validated.projectId), isNull(musicTracks.deletedAt)))

      const isMaster = siblings.length === 0 ? true : validated.isMaster
      if (isMaster) {
        await tx
          .update(musicTracks)
          .set({ isMaster: false })
          .where(and(eq(musicTracks.projectId, validated.projectId), isNull(musicTracks.deletedAt)))
      }

      const rows = await tx
        .insert(musicTracks)
        .values({ ...validated, isMaster, id: newId(MusicTrackIdSchema) })
        .returning()
      const row = rows[0]
      if (!row) throw new Error('music_tracks への INSERT が行を返しませんでした')
      return musicTrackRowToDomain(row)
    })
  },
})
