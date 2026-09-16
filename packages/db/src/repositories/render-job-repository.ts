import { asc, eq } from 'drizzle-orm'
import type {
  CreateRenderJobInput, ProjectId, RenderJob, RenderJobId, UpdateRenderJobPatch,
} from '@ixa/domain'
import {
  CreateRenderJobInput as CreateRenderJobInputSchema,
  RenderJob as RenderJobSchema,
  RenderJobId as RenderJobIdSchema,
  UpdateRenderJobPatch as UpdateRenderJobPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { renderJobs } from '../schema/render.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type RenderJobRow = typeof renderJobs.$inferSelect

/**
 * RenderJob の読み書き。戻り値は必ず `@ixa/domain` の型。
 * DB の行が真実であり、キューは実行手段でしかない（ADR-0008）。
 *
 * timelineSnapshot を差し替える口は持たない。投入時の内容を後から変えられると
 * 「何をレンダリングしたか」が信用できなくなるため（ARCHITECTURE.md §16）。
 */
export type RenderJobRepository = {
  findById(id: RenderJobId): Promise<RenderJob | null>
  /** 投入順（ULID の昇順 = 時系列）。 */
  findByProject(projectId: ProjectId): Promise<RenderJob[]>
  create(input: CreateRenderJobInput): Promise<RenderJob>
  update(id: RenderJobId, patch: UpdateRenderJobPatch): Promise<RenderJob>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const renderJobRowToDomain = (row: RenderJobRow): RenderJob =>
  RenderJobSchema.parse({
    id: row.id,
    projectId: row.projectId,
    scope: row.scope,
    preset: row.preset,
    timelineSnapshot: row.timelineSnapshot,
    status: row.status,
    progress: row.progress,
    outputAssetId: row.outputAssetId,
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  })

export const createRenderJobRepository = (db: DbClient): RenderJobRepository => ({
  async findById(id) {
    const rows = await db.select().from(renderJobs).where(eq(renderJobs.id, id)).limit(1)
    const row = rows[0]
    return row ? renderJobRowToDomain(row) : null
  },

  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(renderJobs)
      .where(eq(renderJobs.projectId, projectId))
      .orderBy(asc(renderJobs.id))
    return rows.map(renderJobRowToDomain)
  },

  async create(input) {
    const validated = CreateRenderJobInputSchema.parse(input)
    const rows = await db
      .insert(renderJobs)
      .values({
        ...validated,
        id: newId(RenderJobIdSchema),
        // 出力・エラー・終了時刻は worker が後から埋める。
        outputAssetId: null,
        error: null,
        createdAt: new Date(),
        finishedAt: null,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('render_jobs への INSERT が行を返しませんでした')
    return renderJobRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateRenderJobPatchSchema.parse(patch)
    const rows = await db.update(renderJobs).set(validated).where(eq(renderJobs.id, id)).returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('RenderJob', id)
    return renderJobRowToDomain(row)
  },
})
