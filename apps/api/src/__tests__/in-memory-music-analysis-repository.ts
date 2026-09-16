import type { MusicAnalysisRepository } from '@ixa/db'
import {
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  newId,
  type MusicAnalysis,
} from '@ixa/domain'

/**
 * MusicAnalysis のインメモリ実装。実 DB には接続しない。
 * 実装と同じく Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 */

/** `create` が採番する createdAt。テストで日時を突き合わせられるよう固定する。 */
export const ANALYSIS_CREATED_AT = new Date('2026-01-01T00:00:00.000Z')

export type InMemoryMusicAnalysisRepository = MusicAnalysisRepository & {
  readonly snapshot: () => readonly MusicAnalysis[]
}

export const createInMemoryMusicAnalysisRepository = (
  seed: readonly MusicAnalysis[] = [],
): InMemoryMusicAnalysisRepository => {
  let store: readonly MusicAnalysis[] = seed.map((analysis) => MusicAnalysisSchema.parse(analysis))

  /** 実装と同じく ULID 降順（＝直近に積まれたものが先頭）で探す。 */
  const latest = (predicate: (analysis: MusicAnalysis) => boolean): MusicAnalysis | null =>
    [...store].reverse().find(predicate) ?? null

  return {
    snapshot: () => store,

    findByTrack: (musicTrackId) =>
      Promise.resolve(latest((analysis) => analysis.musicTrackId === musicTrackId)),

    findByTrackAndVersion: (musicTrackId, analyzerVersion) =>
      Promise.resolve(
        latest(
          (analysis) =>
            analysis.musicTrackId === musicTrackId &&
            analysis.analyzerVersion === analyzerVersion,
        ),
      ),

    create: (input) => {
      const created = MusicAnalysisSchema.parse({
        ...input,
        id: newId(MusicAnalysisIdSchema),
        createdAt: ANALYSIS_CREATED_AT,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
  }
}
