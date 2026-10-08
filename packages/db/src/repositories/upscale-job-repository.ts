import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  UpscaleJob as UpscaleJobSchema,
  newId,
  upscaleJobViolation,
  UpscaleJobId as UpscaleJobIdSchema,
  type ModelId,
  type ProjectId,
  type ProviderId,
  type ShotId,
  type TakeId,
  type UpscaleJob,
  type UpscaleJobError,
  type UpscaleJobId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { upscaleJobs } from '../schema/upscale-job.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type UpscaleJobRow = typeof upscaleJobs.$inferSelect

export type CreateUpscaleJobInput = {
  readonly projectId: ProjectId
  readonly shotId: ShotId
  readonly sourceTakeId: TakeId
  readonly providerId: ProviderId
  readonly modelId: ModelId
}

/** 止める範囲。`shotIds` が無ければ Project の全部。 */
export type UpscaleJobCancelTarget = {
  readonly projectId: ProjectId
  readonly shotIds?: readonly ShotId[]
}

/** 解像度を上げるジョブの読み書き（ADR-0044）。戻り値は必ず `@ixa/domain` の型。 */
export type UpscaleJobRepository = {
  create(input: CreateUpscaleJobInput): Promise<UpscaleJob>
  findById(id: UpscaleJobId): Promise<UpscaleJob | null>
  /** Project の中で待っている・動いているジョブ（二重に積まないため・画面に出すため）。 */
  findActiveByProject(projectId: ProjectId): Promise<UpscaleJob[]>
  /** その Shot の最後のジョブ（状態と失敗の理由を画面に出すため）。 */
  findLatestByShot(shotId: ShotId): Promise<UpscaleJob | null>
  /** 待っている・動いているジョブを止める。止めたジョブを返す。 */
  cancelActive(target: UpscaleJobCancelTarget): Promise<UpscaleJob[]>
  /**
   * 生成先へ送った。**見込み（`estimateSeconds`）はここで入る**
   * （投入してはじめてサーバが返すため）。
   */
  markRunning(id: UpscaleJobId, input: {
    readonly providerJobRef: string
    readonly estimateSeconds: number | null
    readonly providerRecord: Record<string, unknown> | null
  }): Promise<UpscaleJob>
  markSucceeded(
    id: UpscaleJobId,
    takeId: TakeId,
    providerRecord: Record<string, unknown>,
  ): Promise<UpscaleJob>
  markFailed(
    id: UpscaleJobId,
    error: UpscaleJobError,
    providerRecord: Record<string, unknown> | null,
  ): Promise<UpscaleJob>
}

/**
 * row → Domain。zod で検証し、状態と中身の食い違いも止める（`upscaleJobViolation`）。
 * **黙って読み替えない。** 成功なのに Take が無い行を「まだ」に畳むと、どこで落ちたか追えなくなる。
 */
export const upscaleJobRowToDomain = (row: UpscaleJobRow): UpscaleJob => {
  const job = UpscaleJobSchema.parse(row)
  const violation = upscaleJobViolation(job)
  if (violation !== null) {
    throw new Error(`upscale_jobs の行が壊れています（${job.id}）: ${violation}`)
  }
  return job
}

const ACTIVE = inArray(upscaleJobs.status, ['queued', 'running'])

const first = async (rows: Promise<UpscaleJobRow[]>): Promise<UpscaleJob | null> => {
  const row = (await rows)[0]
  return row === undefined ? null : upscaleJobRowToDomain(row)
}

export const createUpscaleJobRepository = (db: DbClient): UpscaleJobRepository => {
  /**
   * 状態を 1 つ進める。書く前に食い違いを確かめる（読み直しと同じ規則）。
   * **止めた行は上書きしない。** そのときは止めた行をそのまま返す（呼び出し側が `cancelled` を見て手を引く）。
   */
  const transition = async (
    id: UpscaleJobId,
    patch: Partial<typeof upscaleJobs.$inferInsert>,
  ): Promise<UpscaleJob> => {
    const rows = await db
      .update(upscaleJobs)
      .set(patch)
      .where(and(eq(upscaleJobs.id, id), ne(upscaleJobs.status, 'cancelled')))
      .returning()
    const row = rows[0]
    if (row !== undefined) return upscaleJobRowToDomain(row)
    const current = await first(db.select().from(upscaleJobs).where(eq(upscaleJobs.id, id)))
    if (current === null) throw new DbNotFoundError('upscale_jobs', id)
    return current
  }

  return {
    async create(input) {
      const rows = await db
        .insert(upscaleJobs)
        .values({
          id: newId(UpscaleJobIdSchema),
          projectId: input.projectId,
          shotId: input.shotId,
          sourceTakeId: input.sourceTakeId,
          status: 'queued',
          providerId: input.providerId,
          modelId: input.modelId,
        })
        .returning()
      const row = rows[0]
      if (row === undefined) throw new Error('upscale_jobs を作れませんでした')
      return upscaleJobRowToDomain(row)
    },

    findById: (id) => first(db.select().from(upscaleJobs).where(eq(upscaleJobs.id, id))),

    async findActiveByProject(projectId) {
      const rows = await db
        .select()
        .from(upscaleJobs)
        .where(and(eq(upscaleJobs.projectId, projectId), ACTIVE))
        .orderBy(desc(upscaleJobs.id))
      return rows.map(upscaleJobRowToDomain)
    },

    findLatestByShot: (shotId) =>
      first(
        db
          .select()
          .from(upscaleJobs)
          .where(eq(upscaleJobs.shotId, shotId))
          .orderBy(desc(upscaleJobs.id))
          .limit(1),
      ),

    async cancelActive({ projectId, shotIds }) {
      if (shotIds !== undefined && shotIds.length === 0) return []
      const rows = await db
        .update(upscaleJobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(
          and(
            eq(upscaleJobs.projectId, projectId),
            ACTIVE,
            ...(shotIds === undefined ? [] : [inArray(upscaleJobs.shotId, [...shotIds])]),
          ),
        )
        .returning()
      return rows.map(upscaleJobRowToDomain)
    },

    markRunning: (id, input) =>
      transition(id, {
        status: 'running',
        providerJobRef: input.providerJobRef,
        estimateSeconds: input.estimateSeconds,
        providerRecord: input.providerRecord,
        startedAt: new Date(),
      }),

    markSucceeded: (id, takeId, providerRecord) =>
      transition(id, { status: 'succeeded', takeId, providerRecord, finishedAt: new Date() }),

    markFailed: (id, error, providerRecord) =>
      transition(id, { status: 'failed', error, providerRecord, finishedAt: new Date() }),
  }
}
