import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type {
  CreateGenerationJobInput, GenerationJob, GenerationJobId, ProjectId, ShotId, UpdateGenerationJobPatch,
} from '@ixa/domain'
import {
  CreateGenerationJobInput as CreateGenerationJobInputSchema,
  GenerationJob as GenerationJobSchema,
  GenerationJobId as GenerationJobIdSchema,
  UpdateGenerationJobPatch as UpdateGenerationJobPatchSchema,
  lineagePairViolation,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { generationJobs } from '../schema/generation.js'
import { shots } from '../schema/shot.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type GenerationJobRow = typeof generationJobs.$inferSelect

/**
 * GenerationJob の読み書き。
 * DB の行が真実であり、キューは実行手段でしかない（ARCHITECTURE.md §20 / ADR-0008）。
 *
 * 系譜（parentTakeId / regenerationReason）も同じ扱いで、**この行が正**である。
 * `create` でだけ書ける。`update` のパッチには含まれないので、後から付け足せない。
 */
export type GenerationJobRepository = {
  findById(id: GenerationJobId): Promise<GenerationJob | null>
  /** 投入順（ULID の昇順 = 時系列）。 */
  findByShot(shotId: ShotId): Promise<GenerationJob[]>
  create(input: CreateGenerationJobInput): Promise<GenerationJob>
  update(id: GenerationJobId, patch: UpdateGenerationJobPatch): Promise<GenerationJob>
}

/**
 * row → Domain。zod で検証して branded ID を付ける。
 *
 * 系譜の対（親があるなら理由もある）は zod のスキーマ側では見ていない。
 * `GenerationJob` に `.refine()` を付けると派生スキーマが作れなくなるため、
 * 規則そのものは domain の `lineagePairViolation` に 1 つだけ置いて、ここで呼ぶ。
 *
 * 対が破れた行は系譜を積む側の書き忘れでしか生まれない。
 * 黙って通すと「何の作り直しか」の分からない Take が確定し、
 * Take は Immutable（ADR-0003）なので後から直せない。読んだ時点で落とす。
 */
export const generationJobRowToDomain = (row: GenerationJobRow): GenerationJob => {
  const violation = lineagePairViolation(row)
  if (violation !== null) {
    throw new Error(`generation_jobs(${row.id}) の系譜が壊れています: ${violation}`)
  }
  return GenerationJobSchema.parse({
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
    parentTakeId: row.parentTakeId,
    regenerationReason: row.regenerationReason,
    corrections: row.corrections,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    providerStartedAt: row.providerStartedAt,
    finishedAt: row.finishedAt,
  })
}

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

/**
 * プロジェクトで動いている生成（順番待ち・作成中）。生きている Shot のものだけ、投入順。
 * 「生成中です」だけでは分からなかったので、画面にモデルと経過を出すのに使う（2026-09-30）。
 */
export const findActiveGenerationJobs = async (db: DbClient, projectId: ProjectId): Promise<GenerationJob[]> => {
  const rows = await db
    .select({ job: generationJobs })
    .from(generationJobs)
    .innerJoin(shots, eq(shots.id, generationJobs.shotId))
    .where(
      and(
        eq(shots.projectId, projectId),
        isNull(shots.deletedAt),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
    .orderBy(asc(generationJobs.id))
  return rows.map((row) => generationJobRowToDomain(row.job))
}
