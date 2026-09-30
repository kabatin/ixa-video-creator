import { eq } from 'drizzle-orm'
import { AiSettings as AiSettingsSchema, type AiSettings } from '@ixa/domain'
import type { DbClient } from '../client.js'
import { aiSettings } from '../schema/ai-settings.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type AiSettingsRow = typeof aiSettings.$inferSelect

/** 1 行だけの表の id（表の check 制約と同じ値）。 */
export const AI_SETTINGS_ROW_ID = 'default'

/** 使う AI の読み書き（ADR-0032）。 */
export type AiSettingsRepository = {
  /** まだ選んでいなければ null。 */
  get(): Promise<AiSettings | null>
  save(settings: AiSettings): Promise<AiSettings>
}

/**
 * row → Domain。**知らない AI の名前が残っていたら null（まだ選んでいない扱い）。**
 * 毎回の読み込みで落とすと、テキストも画像も動画も使えなくなる。画面が選び直しを促す。
 */
export const aiSettingsRowToDomain = (row: AiSettingsRow): AiSettings | null => {
  const parsed = AiSettingsSchema.safeParse({
    text: row.textTool,
    image: row.imageTool,
    video: row.videoTool,
  })
  return parsed.success ? parsed.data : null
}

export const createAiSettingsRepository = (db: DbClient): AiSettingsRepository => ({
  async get() {
    const rows = await db.select().from(aiSettings).where(eq(aiSettings.id, AI_SETTINGS_ROW_ID))
    const row = rows[0]
    return row === undefined ? null : aiSettingsRowToDomain(row)
  },

  async save(settings) {
    const valid = AiSettingsSchema.parse(settings)
    const values = {
      textTool: valid.text,
      imageTool: valid.image,
      videoTool: valid.video,
      updatedAt: new Date(),
    }
    await db
      .insert(aiSettings)
      .values({ id: AI_SETTINGS_ROW_ID, ...values })
      .onConflictDoUpdate({ target: aiSettings.id, set: values })
    return valid
  },
})
