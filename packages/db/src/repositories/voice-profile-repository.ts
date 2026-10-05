import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  CreateVoiceProfileInput as CreateSchema,
  UpdateVoiceProfilePatch as UpdateSchema,
  VoiceProfile as VoiceProfileSchema,
  VoiceProfileId as VoiceProfileIdSchema,
  newId,
  type CreateVoiceProfileInput,
  type ProjectId,
  type UpdateVoiceProfilePatch,
  type VoiceProfile,
  type VoiceProfileId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { voiceProfiles } from '../schema/narration.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type VoiceProfileRow = typeof voiceProfiles.$inferSelect

/** 声の読み書き（ADR-0038）。戻り値は必ず `@ixa/domain` の型。 */
export type VoiceProfileRepository = {
  /** 作った順。論理削除済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<VoiceProfile[]>
  findById(id: VoiceProfileId): Promise<VoiceProfile | null>
  /** 同じ作品に同じ名前があるか（作る・名前を変える前に確かめる）。 */
  findByName(projectId: ProjectId, name: string): Promise<VoiceProfile | null>
  create(input: CreateVoiceProfileInput): Promise<VoiceProfile>
  update(id: VoiceProfileId, patch: UpdateVoiceProfilePatch): Promise<VoiceProfile>
  softDelete(id: VoiceProfileId): Promise<void>
}

/** row → Domain。zod で検証する（知らない AI の名前は黙って読み替えず失敗する）。 */
export const voiceProfileRowToDomain = (row: VoiceProfileRow): VoiceProfile =>
  VoiceProfileSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    tool: row.tool,
    model: row.model,
    voiceName: row.voiceName,
    styleNote: row.styleNote,
    speed: row.speed,
    volume: row.volume,
    language: row.language,
    tuning: row.tuning,
    textStyleId: row.textStyleId,
    characterId: row.characterId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const live = isNull(voiceProfiles.deletedAt)

const single = (rows: VoiceProfileRow[]): VoiceProfile | null => {
  const row = rows[0]
  return row === undefined ? null : voiceProfileRowToDomain(row)
}

export const createVoiceProfileRepository = (db: DbClient): VoiceProfileRepository => ({
  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(voiceProfiles)
      .where(and(eq(voiceProfiles.projectId, projectId), live))
      .orderBy(asc(voiceProfiles.id))
    return rows.map(voiceProfileRowToDomain)
  },

  findById: async (id) => single(await db.select().from(voiceProfiles).where(and(eq(voiceProfiles.id, id), live))),

  findByName: async (projectId, name) =>
    single(
      await db
        .select()
        .from(voiceProfiles)
        .where(and(eq(voiceProfiles.projectId, projectId), eq(voiceProfiles.name, name), live)),
    ),

  async create(input) {
    const valid = CreateSchema.parse(input)
    const rows = await db
      .insert(voiceProfiles)
      .values({ id: newId(VoiceProfileIdSchema), ...valid })
      .returning()
    const created = single(rows)
    if (created === null) throw new Error('声を作れませんでした')
    return created
  },

  async update(id, patch) {
    const valid = UpdateSchema.parse(patch)
    const rows = await db
      .update(voiceProfiles)
      .set({ ...valid, updatedAt: new Date() })
      .where(and(eq(voiceProfiles.id, id), live))
      .returning()
    const updated = single(rows)
    if (updated === null) throw new DbNotFoundError('voice_profiles', id)
    return updated
  },

  async softDelete(id) {
    const rows = await db
      .update(voiceProfiles)
      .set({ deletedAt: new Date() })
      .where(and(eq(voiceProfiles.id, id), live))
      .returning({ id: voiceProfiles.id })
    if (rows.length === 0) throw new DbNotFoundError('voice_profiles', id)
  },
})
