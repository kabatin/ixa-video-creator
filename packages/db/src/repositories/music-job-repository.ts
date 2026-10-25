import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  MusicJob as MusicJobSchema,
  MusicJobId as MusicJobIdSchema,
  MusicJobSpec as MusicJobSpecSchema,
  newId,
  type MusicJob,
  type MusicJobError,
  type MusicJobId,
  type MusicJobSpec,
  type MusicTrackId,
  type ProjectId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { musicJobs } from '../schema/music.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type MusicJobRow = typeof musicJobs.$inferSelect

export type CreateMusicJobInput = {
  readonly projectId: ProjectId
  readonly tool: string
  readonly model: string | null
  readonly spec: MusicJobSpec
}

export type MusicJobOutcome = {
  readonly musicTrackIds: readonly MusicTrackId[]
  readonly providerRecord: Record<string, unknown>
}

/** 曲を作るジョブの読み書き（ADR-0048）。戻り値は必ず `@ixa/domain` の型。 */
export type MusicJobRepository = {
  create(input: CreateMusicJobInput): Promise<MusicJob>
  findById(id: MusicJobId): Promise<MusicJob | null>
  /** 作品の新しい順に `limit` 件（画面の「作った曲」の記録）。 */
  findRecentByProject(projectId: ProjectId, limit: number): Promise<MusicJob[]>
  /** 作品の中で待っている・動いているジョブ。 */
  findActiveByProject(projectId: ProjectId): Promise<MusicJob[]>
  /**
   * 作品の成功したジョブ（新しい順）。楽曲の一覧で、各曲を作ったジョブ（`music_track_ids`）を引くため。
   * 楽曲の側はジョブを指していないので、こちらから引く。
   */
  findSucceededByProject(projectId: ProjectId): Promise<MusicJob[]>
  /** 作品の待っている・動いているジョブを止める。止めたものを返す。 */
  cancelActive(projectId: ProjectId): Promise<MusicJob[]>
  markRunning(id: MusicJobId): Promise<MusicJob>
  /** 生成先に投入した記録を残す（作っている途中で止まったとき、生成先を止めるため）。 */
  recordProvider(id: MusicJobId, providerRecord: Record<string, unknown>): Promise<MusicJob>
  markSucceeded(id: MusicJobId, outcome: MusicJobOutcome): Promise<MusicJob>
  markFailed(id: MusicJobId, error: MusicJobError, providerRecord: Record<string, unknown> | null): Promise<MusicJob>
}

/** row → Domain。形の違う行は黙って読み替えず失敗する。 */
export const musicJobRowToDomain = (row: MusicJobRow): MusicJob =>
  MusicJobSchema.parse({
    id: row.id,
    projectId: row.projectId,
    tool: row.tool,
    model: row.model,
    spec: row.spec,
    status: row.status,
    error: row.error,
    providerRecord: row.providerRecord,
    musicTrackIds: row.musicTrackIds,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  })

const ACTIVE = inArray(musicJobs.status, ['queued', 'running'])

export const createMusicJobRepository = (db: DbExecutor): MusicJobRepository => {
  const first = (rows: MusicJobRow[]): MusicJob | null => {
    const row = rows[0]
    return row === undefined ? null : musicJobRowToDomain(row)
  }

  /** 状態を 1 つ進める。**止めた行は上書きしない**（そのときは止めた行を返す。呼び出し側が手を引く）。 */
  const transition = async (id: MusicJobId, patch: Partial<typeof musicJobs.$inferInsert>): Promise<MusicJob> => {
    const updated = first(
      await db.update(musicJobs).set(patch).where(and(eq(musicJobs.id, id), ne(musicJobs.status, 'cancelled'))).returning(),
    )
    if (updated !== null) return updated
    const current = first(await db.select().from(musicJobs).where(eq(musicJobs.id, id)))
    if (current === null) throw new DbNotFoundError('music_jobs', id)
    return current
  }

  return {
    async create(input) {
      const spec = MusicJobSpecSchema.parse(input.spec)
      const created = first(
        await db
          .insert(musicJobs)
          .values({
            id: newId(MusicJobIdSchema),
            projectId: input.projectId,
            tool: input.tool,
            model: input.model,
            spec,
            status: 'queued',
            queuedAt: new Date(),
          })
          .returning(),
      )
      if (created === null) throw new Error('曲のジョブを作れませんでした')
      return created
    },

    findById: async (id) => first(await db.select().from(musicJobs).where(eq(musicJobs.id, id))),

    async findRecentByProject(projectId, limit) {
      const rows = await db
        .select()
        .from(musicJobs)
        .where(eq(musicJobs.projectId, projectId))
        .orderBy(desc(musicJobs.id))
        .limit(limit)
      return rows.map(musicJobRowToDomain)
    },

    async findActiveByProject(projectId) {
      const rows = await db
        .select()
        .from(musicJobs)
        .where(and(eq(musicJobs.projectId, projectId), ACTIVE))
        .orderBy(desc(musicJobs.id))
      return rows.map(musicJobRowToDomain)
    },

    async findSucceededByProject(projectId) {
      const rows = await db
        .select()
        .from(musicJobs)
        .where(and(eq(musicJobs.projectId, projectId), eq(musicJobs.status, 'succeeded')))
        .orderBy(desc(musicJobs.id))
      return rows.map(musicJobRowToDomain)
    },

    async cancelActive(projectId) {
      const rows = await db
        .update(musicJobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(and(eq(musicJobs.projectId, projectId), ACTIVE))
        .returning()
      return rows.map(musicJobRowToDomain)
    },

    markRunning: (id) => transition(id, { status: 'running', startedAt: new Date() }),

    recordProvider: (id, providerRecord) => transition(id, { providerRecord }),

    markSucceeded: (id, outcome) =>
      transition(id, {
        status: 'succeeded',
        finishedAt: new Date(),
        musicTrackIds: [...outcome.musicTrackIds],
        providerRecord: outcome.providerRecord,
      }),

    markFailed: (id, error, providerRecord) =>
      transition(id, {
        status: 'failed',
        finishedAt: new Date(),
        error,
        ...(providerRecord === null ? {} : { providerRecord }),
      }),
  }
}
