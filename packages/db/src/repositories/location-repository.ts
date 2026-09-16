import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateLocationInput, Location, LocationId, UpdateLocationPatch, WorkspaceId,
} from '@ixa/domain'
import {
  CreateLocationInput as CreateLocationInputSchema,
  Location as LocationSchema,
  LocationId as LocationIdSchema,
  UpdateLocationPatch as UpdateLocationPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { locations } from '../schema/library.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type LocationRow = typeof locations.$inferSelect

/** Location（撮影場所の参照束）の読み書き（DOMAIN.md §6）。戻り値は必ず `@ixa/domain` の型。 */
export type LocationRepository = {
  findById(id: LocationId): Promise<Location | null>
  /** 作成順（ULID 昇順）。ソフトデリート済みは含まない。 */
  findByWorkspace(workspaceId: WorkspaceId): Promise<Location[]>
  create(input: CreateLocationInput): Promise<Location>
  update(id: LocationId, patch: UpdateLocationPatch): Promise<Location>
  softDelete(id: LocationId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const locationRowToDomain = (row: LocationRow): Location =>
  LocationSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    referenceAssetIds: row.referenceAssetIds,
  })

const liveById = (id: LocationId) => and(eq(locations.id, id), isNull(locations.deletedAt))

export const createLocationRepository = (db: DbClient): LocationRepository => ({
  async findById(id) {
    const rows = await db.select().from(locations).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? locationRowToDomain(row) : null
  },

  async findByWorkspace(workspaceId) {
    const rows = await db
      .select()
      .from(locations)
      .where(and(eq(locations.workspaceId, workspaceId), isNull(locations.deletedAt)))
      .orderBy(asc(locations.id))
    return rows.map(locationRowToDomain)
  },

  async create(input) {
    const validated = CreateLocationInputSchema.parse(input)
    const rows = await db
      .insert(locations)
      .values({ ...validated, id: newId(LocationIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('locations への INSERT が行を返しませんでした')
    return locationRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateLocationPatchSchema.parse(patch)
    const rows = await db.update(locations).set(validated).where(liveById(id)).returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('Location', id)
    return locationRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(locations)
      .set({ deletedAt: new Date() })
      .where(liveById(id))
      .returning({ id: locations.id })
    if (rows.length === 0) throw new DbNotFoundError('Location', id)
  },
})
