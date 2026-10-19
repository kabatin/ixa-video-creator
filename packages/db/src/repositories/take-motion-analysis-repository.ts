import { and, desc, eq, inArray } from 'drizzle-orm'
import type { CreateMotionAnalysisInput, MotionAnalysis, TakeId } from '@ixa/domain'
import { MotionAnalysis as MotionAnalysisSchema, TakeMotionAnalysisId, newId } from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { takeMotionAnalyses } from '../schema/take-motion-analysis.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type TakeMotionAnalysisRow = typeof takeMotionAnalyses.$inferSelect

/**
 * Take の動きの分析の読み書き（ADR-0054）。戻り値は必ず `@ixa/domain` の型。
 * **追記のみ。** UPDATE するメソッドを足してはいけない。作り直しは新しい行。
 */
export type TakeMotionAnalysisRepository = {
  /** いちばん新しい行（成功・失敗を問わない）。無ければ null。 */
  findLatestByTake(takeId: TakeId): Promise<MotionAnalysis | null>
  /** Take ごとのいちばん新しい**成功**の行。タイムラインの印に使う。成功の無い Take は入らない。 */
  findLatestSucceededByTakes(takeIds: readonly TakeId[]): Promise<ReadonlyMap<TakeId, MotionAnalysis>>
  create(input: CreateMotionAnalysisInput): Promise<MotionAnalysis>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const takeMotionAnalysisRowToDomain = (row: TakeMotionAnalysisRow): MotionAnalysis =>
  MotionAnalysisSchema.parse({
    id: row.id,
    takeId: row.takeId,
    analyzerVersion: row.analyzerVersion,
    status: row.status,
    energyHopSec: row.energyHopSec,
    energy: row.energy,
    onsets: row.onsets,
    events: row.events,
    visionUsed: row.visionUsed,
    costUsd: row.costUsd,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt,
  })

export const createTakeMotionAnalysisRepository = (db: DbExecutor): TakeMotionAnalysisRepository => ({
  async findLatestByTake(takeId) {
    const rows = await db
      .select()
      .from(takeMotionAnalyses)
      .where(eq(takeMotionAnalyses.takeId, takeId))
      .orderBy(desc(takeMotionAnalyses.id))
      .limit(1)
    const row = rows[0]
    return row ? takeMotionAnalysisRowToDomain(row) : null
  },

  async findLatestSucceededByTakes(takeIds) {
    if (takeIds.length === 0) return new Map()
    const rows = await db
      .select()
      .from(takeMotionAnalyses)
      .where(and(inArray(takeMotionAnalyses.takeId, [...takeIds]), eq(takeMotionAnalyses.status, 'succeeded')))
      .orderBy(desc(takeMotionAnalyses.id))
    // 新しい順に読むので、Take ごとに最初に出た行が最新。
    return rows.reduce<Map<TakeId, MotionAnalysis>>((latest, row) => {
      const analysis = takeMotionAnalysisRowToDomain(row)
      return latest.has(analysis.takeId) ? latest : new Map([...latest, [analysis.takeId, analysis]])
    }, new Map())
  },

  async create(input) {
    const validated = MotionAnalysisSchema.parse({ ...input, id: newId(TakeMotionAnalysisId), createdAt: new Date() })
    const rows = await db.insert(takeMotionAnalyses).values(validated).returning()
    const row = rows[0]
    if (!row) throw new Error('take_motion_analyses への INSERT が行を返しませんでした')
    return takeMotionAnalysisRowToDomain(row)
  },
})
