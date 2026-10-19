import type { TakeMotionAnalysisRepository } from '@ixa/db'
import { TakeMotionAnalysisId, newId, type MotionAnalysis } from '@ixa/domain'

/** Take の動きの分析のメモリ版（ADR-0054）。追記のみで、新しい行ほど後ろ。 */
export type InMemoryMotionAnalysisRepository = TakeMotionAnalysisRepository & {
  readonly snapshot: () => readonly MotionAnalysis[]
}

export const createInMemoryMotionAnalysisRepository = (
  seed: readonly MotionAnalysis[] = [],
): InMemoryMotionAnalysisRepository => {
  let rows: readonly MotionAnalysis[] = seed
  const latest = (predicate: (row: MotionAnalysis) => boolean): MotionAnalysis | null =>
    [...rows].reverse().find(predicate) ?? null
  return {
    snapshot: () => rows,
    findLatestByTake: (takeId) => Promise.resolve(latest((row) => row.takeId === takeId)),
    findLatestSucceededByTakes: (takeIds) =>
      Promise.resolve(
        new Map(
          takeIds.flatMap((takeId) => {
            const found = latest((row) => row.takeId === takeId && row.status === 'succeeded')
            return found === null ? [] : [[takeId, found] as const]
          }),
        ),
      ),
    create: (input) => {
      const row: MotionAnalysis = { ...input, id: newId(TakeMotionAnalysisId), createdAt: new Date() }
      rows = [...rows, row]
      return Promise.resolve(row)
    },
  }
}
