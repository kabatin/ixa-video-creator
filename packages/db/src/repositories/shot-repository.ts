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
  /**
   * 複数の Shot を **1 トランザクションで**追加する（ストーリーボードの一括作成）。
   * 途中で失敗して半分だけ残ると、タイムラインに隙間のある状態が DB に居座る。
   * 空配列を渡すのは呼び出し側の誤りなので例外にする。
   */
  createMany(inputs: readonly CreateShotInput[]): Promise<Shot[]>
  update(id: ShotId, patch: UpdateShotPatch): Promise<Shot>
  softDelete(id: ShotId): Promise<void>
  /** 採用 Take を差し替える。sourceInSec は維持する（ADR-0011）。 */
  /**
   * 採用 Take を設定する。**`null` で採用を外す。**
   *
   * 外せる必要があるのは、一括編集の取り消し（Undo）が
   * 「採用していなかった状態」へ戻すため。`Shot.selectedTakeId` は元から
   * nullable なので、外せないのは口の側の制限でしかなかった。
   */
  selectTake(shotId: ShotId, takeId: TakeId | null): Promise<Shot>
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
    timing: row.timing,
    description: row.description,
    dialogue: row.dialogue,
    camera: row.camera,
    mood: row.mood,
    continuityMode: row.continuityMode,
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

    async createMany(inputs) {
      if (inputs.length === 0) throw new Error('createMany に空の配列が渡されました')
      const validated = inputs.map((input) => CreateShotInputSchema.parse(input))
      const now = new Date()

      // 全件まとめて 1 文で入れる。1 件ずつ回すと部分的に残る余地ができる。
      const rows = await db
        .insert(shots)
        .values(
          validated.map((input) => ({
            ...input,
            id: newId(ShotIdSchema),
            selectedTakeId: null,
            lockedAt: null,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .returning()

      if (rows.length !== validated.length) {
        throw new Error(
          `shots への一括 INSERT が ${String(rows.length)} 行しか返しませんでした（要求 ${String(validated.length)} 行）`,
        )
      }
      return rows.map(shotRowToDomain)
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
