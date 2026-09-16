import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateShotInput, ProjectId, Shot, ShotId, ShotStatus, TakeId, UpdateShotPatch,
} from '@ixa/domain'
import {
  CreateShotInput as CreateShotInputSchema,
  Shot as ShotSchema,
  ShotId as ShotIdSchema,
  UpdateShotPatch as UpdateShotPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { shots } from '../schema/shot.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ShotRow = typeof shots.$inferSelect

/**
 * Shot の読み書き。戻り値は必ず `@ixa/domain` の型。
 * selectedTakeId と status は不変条件を伴うため汎用 patch では更新できない
 * （selectTake / updateStatus を使う）。
 */
export type ShotRepository = {
  findById(id: ShotId): Promise<Shot | null>
  /** order 昇順。ソフトデリート済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<Shot[]>
  create(input: CreateShotInput): Promise<Shot>
  update(id: ShotId, patch: UpdateShotPatch): Promise<Shot>
  softDelete(id: ShotId): Promise<void>
  /** 採用 Take を差し替える。sourceInSec は維持する（ADR-0011）。 */
  selectTake(shotId: ShotId, takeId: TakeId): Promise<Shot>
  updateStatus(shotId: ShotId, status: ShotStatus): Promise<Shot>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const shotRowToDomain = (row: ShotRow): Shot =>
  ShotSchema.parse({
    id: row.id,
    projectId: row.projectId,
    sequenceId: row.sequenceId,
    order: row.order,
    code: row.code,
    startSec: row.startSec,
    durationSec: row.durationSec,
    sourceInSec: row.sourceInSec,
    description: row.description,
    dialogue: row.dialogue,
    camera: row.camera,
    mood: row.mood,
    locationId: row.locationId,
    sourceType: row.sourceType,
    selectedTakeId: row.selectedTakeId,
    status: row.status,
    lockedAt: row.lockedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const liveById = (id: ShotId) => and(eq(shots.id, id), isNull(shots.deletedAt))

export const createShotRepository = (db: DbClient): ShotRepository => {
  /** 生存行を 1 件更新して Domain 型で返す。対象が無ければ DbNotFoundError。 */
  const updateLive = async (
    id: ShotId,
    values: Partial<typeof shots.$inferInsert>,
  ): Promise<Shot> => {
    const rows = await db
      .update(shots)
      .set({ ...values, updatedAt: new Date() })
      .where(liveById(id))
      .returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('Shot', id)
    return shotRowToDomain(row)
  }

  return {
    async findById(id) {
      const rows = await db.select().from(shots).where(liveById(id)).limit(1)
      const row = rows[0]
      return row ? shotRowToDomain(row) : null
    },

    async findByProject(projectId) {
      const rows = await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, projectId), isNull(shots.deletedAt)))
        .orderBy(asc(shots.order))
      return rows.map(shotRowToDomain)
    },

    async create(input) {
      const validated = CreateShotInputSchema.parse(input)
      const now = new Date()
      const rows = await db
        .insert(shots)
        .values({
          ...validated,
          id: newId(ShotIdSchema),
          selectedTakeId: null,
          lockedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      const row = rows[0]
      if (!row) throw new Error('shots への INSERT が行を返しませんでした')
      return shotRowToDomain(row)
    },

    update: async (id, patch) => updateLive(id, UpdateShotPatchSchema.parse(patch)),

    async softDelete(id) {
      const rows = await db
        .update(shots)
        .set({ deletedAt: new Date() })
        .where(liveById(id))
        .returning({ id: shots.id })
      if (rows.length === 0) throw new DbNotFoundError('Shot', id)
    },

    selectTake: async (shotId, takeId) => updateLive(shotId, { selectedTakeId: takeId }),

    updateStatus: async (shotId, status) => updateLive(shotId, { status }),
  }
}
