import { eq } from 'drizzle-orm'
import type { MusicTrackId } from '@ixa/domain'
import type { DbClient } from '../client.js'
import { musicAnalysisFailures } from '../schema/music.js'

/** 解析の失敗 1 件。`message` は利用者に見せてよい文だけ（URL や例外の本文は入れない）。 */
export type MusicAnalysisFailure = {
  readonly message: string
  readonly failedAt: Date
}

/**
 * 解析の失敗の置き場（`music_analysis_failures`）。1 曲につき直近の 1 件だけ持つ。
 *
 * 失敗は worker が書き、解析をやり直すとき（API）と成功したとき（worker）に消す。
 * 画面はこれを読んで「まだ終わっていない」と「失敗した」を分ける。
 */
export type MusicAnalysisFailureRepository = {
  find(musicTrackId: MusicTrackId): Promise<MusicAnalysisFailure | null>
  /** 直近の失敗として残す。前の失敗は置き換える。 */
  record(musicTrackId: MusicTrackId, message: string): Promise<void>
  clear(musicTrackId: MusicTrackId): Promise<void>
}

export const createMusicAnalysisFailureRepository = (
  db: DbClient,
): MusicAnalysisFailureRepository => ({
  find: async (musicTrackId) => {
    const [row] = await db
      .select()
      .from(musicAnalysisFailures)
      .where(eq(musicAnalysisFailures.musicTrackId, musicTrackId))
      .limit(1)
    return row === undefined ? null : { message: row.message, failedAt: row.failedAt }
  },

  record: async (musicTrackId, message) => {
    const failedAt = new Date()
    await db
      .insert(musicAnalysisFailures)
      .values({ musicTrackId, message, failedAt })
      .onConflictDoUpdate({
        target: musicAnalysisFailures.musicTrackId,
        set: { message, failedAt },
      })
  },

  clear: async (musicTrackId) => {
    await db.delete(musicAnalysisFailures).where(eq(musicAnalysisFailures.musicTrackId, musicTrackId))
  },
})
