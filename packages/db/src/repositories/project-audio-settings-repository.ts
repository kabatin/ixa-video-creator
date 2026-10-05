import { eq } from 'drizzle-orm'
import {
  ProjectAudioSettings as ProjectAudioSettingsSchema,
  defaultAudioSettings,
  type ProjectAudioSettings,
  type ProjectId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { projectAudioSettings } from '../schema/narration.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ProjectAudioSettingsRow = typeof projectAudioSettings.$inferSelect

/** 作品ごとの音の設定（読み辞書・ダッキング。ADR-0038・0039）。 */
export type ProjectAudioSettingsRepository = {
  /** まだ設定していなければ既定（辞書は空・ダッキングはオンで中）。 */
  get(projectId: ProjectId): Promise<ProjectAudioSettings>
  save(settings: ProjectAudioSettings): Promise<ProjectAudioSettings>
}

/** row → Domain。更新した時刻（updated_at）は Domain に出さない。 */
export const audioSettingsRowToDomain = (row: ProjectAudioSettingsRow): ProjectAudioSettings =>
  ProjectAudioSettingsSchema.parse({
    projectId: row.projectId,
    readingDictionary: row.readingDictionary,
    ducking: row.ducking,
  })

export const createProjectAudioSettingsRepository = (db: DbClient): ProjectAudioSettingsRepository => ({
  async get(projectId) {
    const rows = await db.select().from(projectAudioSettings).where(eq(projectAudioSettings.projectId, projectId))
    const row = rows[0]
    return row === undefined ? defaultAudioSettings(projectId) : audioSettingsRowToDomain(row)
  },

  async save(settings) {
    const valid = ProjectAudioSettingsSchema.parse(settings)
    const values = { readingDictionary: [...valid.readingDictionary], ducking: valid.ducking, updatedAt: new Date() }
    await db
      .insert(projectAudioSettings)
      .values({ projectId: valid.projectId, ...values })
      .onConflictDoUpdate({ target: projectAudioSettings.projectId, set: values })
    return valid
  },
})
