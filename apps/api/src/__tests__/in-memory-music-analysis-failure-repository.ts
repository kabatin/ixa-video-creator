import type { MusicAnalysisFailure, MusicAnalysisFailureRepository } from '@ixa/db'
import type { MusicTrackId } from '@ixa/domain'

/** 解析の失敗の置き場の代役。1 曲につき直近の 1 件だけ持つ（本物と同じ）。 */
export const createInMemoryMusicAnalysisFailureRepository = (): MusicAnalysisFailureRepository & {
  snapshot(): ReadonlyMap<MusicTrackId, MusicAnalysisFailure>
} => {
  let rows = new Map<MusicTrackId, MusicAnalysisFailure>()
  return {
    find: (musicTrackId) => Promise.resolve(rows.get(musicTrackId) ?? null),
    record: (musicTrackId, message) => {
      rows = new Map(rows).set(musicTrackId, { message, failedAt: new Date() })
      return Promise.resolve()
    },
    clear: (musicTrackId) => {
      const next = new Map(rows)
      next.delete(musicTrackId)
      rows = next
      return Promise.resolve()
    },
    snapshot: () => rows,
  }
}
