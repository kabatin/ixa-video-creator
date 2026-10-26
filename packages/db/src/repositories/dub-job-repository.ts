import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  DubJob as DubJobSchema,
  DubJobId as DubJobIdSchema,
  DubParams as DubParamsSchema,
  dubJobViolation,
  newId,
  type DubJob,
  type DubJobError,
  type DubJobId,
  type DubParams,
  type ProjectId,
  type ShotId,
  type TakeId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { dubJobs } from '../schema/dub.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type DubJobRow = typeof dubJobs.$inferSelect

export type CreateDubJobInput = {
  readonly projectId: ProjectId
  readonly shotId: ShotId
  readonly sourceTakeId: TakeId
}

/** 声の差し替えのジョブの読み書き（ADR-0062）。戻り値は必ず `@ixa/domain` の型。 */
export type DubJobRepository = {
  create(input: CreateDubJobInput): Promise<DubJob>
  findById(id: DubJobId): Promise<DubJob | null>
  /** 作品の中で待っている・動いているジョブ（二重に積まないため・作品の動いているジョブの一覧に出すため）。 */
  findActiveByProject(projectId: ProjectId): Promise<DubJob[]>
  /** その Shot の最後のジョブ（進み具合・失敗の理由・結果の表を画面に出すため）。 */
  findLatestByShot(shotId: ShotId): Promise<DubJob | null>
  /** 待っている・動いているなら止める。止めた行（または今の行）を返す。 */
  cancel(id: DubJobId): Promise<DubJob>
  markRunning(id: DubJobId): Promise<DubJob>
  markSucceeded(id: DubJobId, input: { readonly takeId: TakeId; readonly costUsd: number; readonly record: DubParams }): Promise<DubJob>
  markFailed(id: DubJobId, error: DubJobError, costUsd: number): Promise<DubJob>
}

/** row → Domain。zod で検証し、状態と中身の食い違いも止める（黙って読み替えない）。 */
export const dubJobRowToDomain = (row: DubJobRow): DubJob => {
  const job = DubJobSchema.parse(row)
  const violation = dubJobViolation(job)
  if (violation !== null) throw new Error(`dub_jobs の行が壊れています（${job.id}）: ${violation}`)
  return job
}

const ACTIVE = inArray(dubJobs.status, ['queued', 'running'])

const first = async (rows: Promise<DubJobRow[]>): Promise<DubJob | null> => {
  const row = (await rows)[0]
  return row === undefined ? null : dubJobRowToDomain(row)
}

export const createDubJobRepository = (db: DbExecutor): DubJobRepository => {
  /** 状態を 1 つ進める。**止めた行は上書きしない**（止めた行をそのまま返す。呼び出し側が `cancelled` を見て手を引く）。 */
  const transition = async (id: DubJobId, patch: Partial<typeof dubJobs.$inferInsert>): Promise<DubJob> => {
    const rows = await db
      .update(dubJobs)
      .set(patch)
      .where(and(eq(dubJobs.id, id), ne(dubJobs.status, 'cancelled')))
      .returning()
    const row = rows[0]
    if (row !== undefined) return dubJobRowToDomain(row)
    const current = await first(db.select().from(dubJobs).where(eq(dubJobs.id, id)))
    if (current === null) throw new DbNotFoundError('dub_jobs', id)
    return current
  }

  return {
    async create(input) {
      const rows = await db
        .insert(dubJobs)
        .values({ id: newId(DubJobIdSchema), ...input, status: 'queued' })
        .returning()
      const row = rows[0]
      if (row === undefined) throw new Error('dub_jobs を作れませんでした')
      return dubJobRowToDomain(row)
    },

    findById: (id) => first(db.select().from(dubJobs).where(eq(dubJobs.id, id))),

    async findActiveByProject(projectId) {
      const rows = await db
        .select()
        .from(dubJobs)
        .where(and(eq(dubJobs.projectId, projectId), ACTIVE))
        .orderBy(desc(dubJobs.id))
      return rows.map(dubJobRowToDomain)
    },

    findLatestByShot: (shotId) =>
      first(db.select().from(dubJobs).where(eq(dubJobs.shotId, shotId)).orderBy(desc(dubJobs.id)).limit(1)),

    async cancel(id) {
      const rows = await db
        .update(dubJobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(and(eq(dubJobs.id, id), ACTIVE))
        .returning()
      const row = rows[0]
      if (row !== undefined) return dubJobRowToDomain(row)
      const current = await first(db.select().from(dubJobs).where(eq(dubJobs.id, id)))
      if (current === null) throw new DbNotFoundError('dub_jobs', id)
      return current
    },

    markRunning: (id) => transition(id, { status: 'running', startedAt: new Date() }),

    markSucceeded: (id, input) =>
      transition(id, {
        status: 'succeeded',
        takeId: input.takeId,
        costUsd: input.costUsd,
        // 書く前に形を確かめる（壊れた記録を残さない）。
        record: DubParamsSchema.parse(input.record),
        finishedAt: new Date(),
      }),

    markFailed: (id, error, costUsd) => transition(id, { status: 'failed', error, costUsd, finishedAt: new Date() }),
  }
}
