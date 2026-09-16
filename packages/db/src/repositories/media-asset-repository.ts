import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateMediaAssetInput, MediaAsset, MediaAssetId, ProjectId,
  UpdateMediaAssetPatch, WorkspaceId,
} from '@ixa/domain'
import {
  CreateMediaAssetInput as CreateMediaAssetInputSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  UpdateMediaAssetPatch as UpdateMediaAssetPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { mediaAssets } from '../schema/media.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type MediaAssetRow = typeof mediaAssets.$inferSelect

export type MediaAssetRepository = {
  findById(id: MediaAssetId): Promise<MediaAsset | null>
  findByWorkspace(workspaceId: WorkspaceId): Promise<MediaAsset[]>
  findByProject(projectId: ProjectId): Promise<MediaAsset[]>
  /** 重複排除用。生存行のみ対象（UNIQUE 部分インデックスと同じ条件）。 */
  findByChecksum(checksumSha256: string): Promise<MediaAsset | null>
  create(input: CreateMediaAssetInput): Promise<MediaAsset>
  update(id: MediaAssetId, patch: UpdateMediaAssetPatch): Promise<MediaAsset>
  softDelete(id: MediaAssetId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const mediaAssetRowToDomain = (row: MediaAssetRow): MediaAsset =>
  MediaAssetSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    kind: row.kind,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    bytes: row.bytes,
    checksumSha256: row.checksumSha256,
    probe: row.probe,
    proxyKey: row.proxyKey,
    thumbnailKey: row.thumbnailKey,
    posterKeys: row.posterKeys,
    origin: row.origin,
    tags: row.tags,
    createdAt: row.createdAt,
  })

const liveById = (id: MediaAssetId) =>
  and(eq(mediaAssets.id, id), isNull(mediaAssets.deletedAt))

export const createMediaAssetRepository = (db: DbClient): MediaAssetRepository => ({
  async findById(id) {
    const rows = await db.select().from(mediaAssets).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? mediaAssetRowToDomain(row) : null
  },

  async findByWorkspace(workspaceId) {
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.workspaceId, workspaceId), isNull(mediaAssets.deletedAt)))
      .orderBy(asc(mediaAssets.id))
    return rows.map(mediaAssetRowToDomain)
  },

  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt)))
      .orderBy(asc(mediaAssets.id))
    return rows.map(mediaAssetRowToDomain)
  },

  async findByChecksum(checksumSha256) {
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.checksumSha256, checksumSha256), isNull(mediaAssets.deletedAt)))
      .limit(1)
    const row = rows[0]
    return row ? mediaAssetRowToDomain(row) : null
  },

  async create(input) {
    const validated = CreateMediaAssetInputSchema.parse(input)
    const rows = await db
      .insert(mediaAssets)
      .values({ ...validated, id: newId(MediaAssetIdSchema), createdAt: new Date() })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('media_assets への INSERT が行を返しませんでした')
    return mediaAssetRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateMediaAssetPatchSchema.parse(patch)
    const rows = await db.update(mediaAssets).set(validated).where(liveById(id)).returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('MediaAsset', id)
    return mediaAssetRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(mediaAssets)
      .set({ deletedAt: new Date() })
      .where(liveById(id))
      .returning({ id: mediaAssets.id })
    if (rows.length === 0) throw new DbNotFoundError('MediaAsset', id)
  },
})
