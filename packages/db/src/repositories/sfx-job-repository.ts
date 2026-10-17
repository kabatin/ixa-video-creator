import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  SfxJob as SfxJobSchema,
  SfxJobId as SfxJobIdSchema,
  SfxJobSpec as SfxJobSpecSchema,
  newId,
  type MediaAssetId,
  type ProjectId,
  type SfxJob,
  type SfxJobError,
  type SfxJobId,
  type SfxJobSpec,
  type TimelineClipId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { sfxJobs } from '../schema/sfx.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type SfxJobRow = typeof sfxJobs.$inferSelect

export type CreateSfxJobInput = {
  readonly projectId: ProjectId
  readonly tool: string
  readonly model: string | null
  readonly spec: SfxJobSpec
}

export type SfxJobOutcome = {
  readonly mediaAssetIds: readonly MediaAssetId[]
  readonly timelineClipId: TimelineClipId | null
  readonly providerRecord: Record<string, unknown>
}

/** 効果音を作るジョブの読み書き（ADR-0052）。戻り値は必ず `@ixa/domain` の型。 */
export type SfxJobRepository = {
  create(input: CreateSfxJobInput): Promise<SfxJob>
  findById(id: SfxJobId): Promise<SfxJob | null>
  /** 作品の新しい順に `limit` 件。 */
  findRecentByProject(projectId: ProjectId, limit: number): Promise<SfxJob[]>
  /** 作品の中で待っている・動いているジョブ。 */
  findActiveByProject(projectId: ProjectId): Promise<SfxJob[]>
  /** 作品の待っている・動いているジョブを止める。止めたものを返す。 */
  cancelActive(projectId: ProjectId): Promise<SfxJob[]>
  markRunning(id: SfxJobId): Promise<SfxJob>
  /** 生成先に投入した記録を残す（作っている途中で止まったとき、生成先を止めるため）。 */
  recordProvider(id: SfxJobId, providerRecord: Record<string, unknown>): Promise<SfxJob>
  /**
   * 置いたクリップを**置いた直後に**記す。やり直したジョブは、記されたクリップだけを「もう置いた」とみなす
   * （同じ素材のクリップを探して使い回すと、同じ音の別のきっかけが置かれない）。
   */
  recordClip(id: SfxJobId, timelineClipId: TimelineClipId): Promise<SfxJob>
  /** 成功にする。**待っている・作っている行だけ。** 失敗にした行（キューが打ち切った）を後から成功に戻さない。 */
  markSucceeded(id: SfxJobId, outcome: SfxJobOutcome): Promise<SfxJob>
  markFailed(id: SfxJobId, error: SfxJobError, providerRecord: Record<string, unknown> | null): Promise<SfxJob>
}

/** row → Domain。形の違う行は黙って読み替えず失敗する。 */
export const sfxJobRowToDomain = (row: SfxJobRow): SfxJob =>
  SfxJobSchema.parse({
    id: row.id,
    projectId: row.projectId,
    tool: row.tool,
    model: row.model,
    spec: row.spec,
    status: row.status,
    error: row.error,
    providerRecord: row.providerRecord,
    mediaAssetIds: row.mediaAssetIds,
    timelineClipId: row.timelineClipId,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  })

const ACTIVE = inArray(sfxJobs.status, ['queued', 'running'])

export const createSfxJobRepository = (db: DbClient): SfxJobRepository => {
  const first = (rows: SfxJobRow[]): SfxJob | null => {
    const row = rows[0]
    return row === undefined ? null : sfxJobRowToDomain(row)
  }

  /**
   * 状態を 1 つ進める。**止めた行は上書きしない**（そのときは止めた行を返す。呼び出し側が手を引く）。
   * `onlyActive` なら、待っている・作っている行だけを動かす（終わった行はそのまま返す）。
   */
  const transition = async (
    id: SfxJobId,
    patch: Partial<typeof sfxJobs.$inferInsert>,
    onlyActive = false,
  ): Promise<SfxJob> => {
    const guard = onlyActive ? ACTIVE : ne(sfxJobs.status, 'cancelled')
    const updated = first(await db.update(sfxJobs).set(patch).where(and(eq(sfxJobs.id, id), guard)).returning())
    if (updated !== null) return updated
    const current = first(await db.select().from(sfxJobs).where(eq(sfxJobs.id, id)))
    if (current === null) throw new DbNotFoundError('sfx_jobs', id)
    return current
  }

  return {
    async create(input) {
      const spec = SfxJobSpecSchema.parse(input.spec)
      const created = first(
        await db
          .insert(sfxJobs)
          .values({
            id: newId(SfxJobIdSchema),
            projectId: input.projectId,
            tool: input.tool,
            model: input.model,
            spec,
            status: 'queued',
            queuedAt: new Date(),
          })
          .returning(),
      )
      if (created === null) throw new Error('効果音のジョブを作れませんでした')
      return created
    },

    findById: async (id) => first(await db.select().from(sfxJobs).where(eq(sfxJobs.id, id))),

    async findRecentByProject(projectId, limit) {
      const rows = await db
        .select()
        .from(sfxJobs)
        .where(eq(sfxJobs.projectId, projectId))
        .orderBy(desc(sfxJobs.id))
        .limit(limit)
      return rows.map(sfxJobRowToDomain)
    },

    async findActiveByProject(projectId) {
      const rows = await db
        .select()
        .from(sfxJobs)
        .where(and(eq(sfxJobs.projectId, projectId), ACTIVE))
        .orderBy(desc(sfxJobs.id))
      return rows.map(sfxJobRowToDomain)
    },

    async cancelActive(projectId) {
      const rows = await db
        .update(sfxJobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(and(eq(sfxJobs.projectId, projectId), ACTIVE))
        .returning()
      return rows.map(sfxJobRowToDomain)
    },

    markRunning: (id) => transition(id, { status: 'running', startedAt: new Date() }),

    recordProvider: (id, providerRecord) => transition(id, { providerRecord }),

    recordClip: (id, timelineClipId) => transition(id, { timelineClipId }),

    markSucceeded: (id, outcome) =>
      transition(
        id,
        {
          status: 'succeeded',
          finishedAt: new Date(),
          mediaAssetIds: [...outcome.mediaAssetIds],
          timelineClipId: outcome.timelineClipId,
          providerRecord: outcome.providerRecord,
        },
        true,
      ),

    markFailed: (id, error, providerRecord) =>
      transition(id, {
        status: 'failed',
        finishedAt: new Date(),
        error,
        ...(providerRecord === null ? {} : { providerRecord }),
      }),
  }
}
