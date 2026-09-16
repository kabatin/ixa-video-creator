import { asc, eq } from 'drizzle-orm'
import type {
  CreateGenerationJobInput, GenerationJob, GenerationJobId, ShotId, UpdateGenerationJobPatch,
} from '@ixa/domain'
import {
  CreateGenerationJobInput as CreateGenerationJobInputSchema,
  GenerationJob as GenerationJobSchema,
  GenerationJobId as GenerationJobIdSchema,
  UpdateGenerationJobPatch as UpdateGenerationJobPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { generationJobs } from '../schema/generation.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type GenerationJobRow = typeof generationJobs.$inferSelect

/**
 * GenerationJob の読み書き。
 * DB の行が真実であり、キューは実行手段でしかない（ARCHITECTURE.md §20 / ADR-0008）。
 */
export type GenerationJobRepository = {
  findById(id: GenerationJobId): Promise<GenerationJob | null>
  /** 投入順（ULID の昇順 = 時系列）。 */
  findByShot(shotId: ShotId): Promise<GenerationJob[]>
  create(input: CreateGenerationJobInput): Promise<GenerationJob>
  update(id: GenerationJobId, patch: UpdateGenerationJobPatch): Promise<GenerationJob>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const generationJobRowToDomain = (row: GenerationJobRow): GenerationJob =>
  GenerationJobSchema.parse({
    id: row.id,
    shotId: row.shotId,
    specHash: row.specHash,
    requestedModel: row.requestedModel,
    resolvedModel: row.resolvedModel,
    routerDecision: row.routerDecision,
    status: row.status,
    attempt: row.attempt,
    providerJobRef: row.providerJobRef,
    error: row.error,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  })

export const createGenerationJobRepository = (db: DbClient): GenerationJobRepository => ({
  async findById(id) {
    const rows = await db.select().from(generationJobs).where(eq(generationJobs.id, id)).limit(1)
    const row = rows[0]
    return row ? generationJobRowToDomain(row) : null
  },

  async findByShot(shotId) {
    const rows = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.shotId, shotId))
      .orderBy(asc(generationJobs.id))
    return rows.map(generationJobRowToDomain)
  },

  async create(input) {
    const validated = CreateGenerationJobInputSchema.parse(input)
    const rows = await db
      .insert(generationJobs)
      .values({
        ...validated,
        id: newId(GenerationJobIdSchema),
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('generation_jobs への INSERT が行を返しませんでした')
    return generationJobRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateGenerationJobPatchSchema.parse(patch)
    const rows = await db
      .update(generationJobs)
      .set(validated)
      .where(eq(generationJobs.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('GenerationJob', id)
    return generationJobRowToDomain(row)
  },
})
