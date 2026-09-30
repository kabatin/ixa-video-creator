import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  AI_SETTINGS_ROW_ID,
  aiSettingsRowToDomain,
  type AiSettingsRow,
} from '../repositories/ai-settings-repository.js'
import { aiSettings } from '../schema/ai-settings.js'

/** 使う AI（ADR-0032）。この環境に 1 行だけ持つ。 */
describe('ai_settings', () => {
  const row = (patch: Partial<AiSettingsRow> = {}): AiSettingsRow => ({
    id: AI_SETTINGS_ROW_ID,
    textTool: 'claude_cli',
    imageTool: 'codex_cli',
    videoTool: 'local',
    updatedAt: new Date('2026-09-30T00:00:00Z'),
    ...patch,
  })

  it('行を用途ごとの選択にする', () => {
    expect(aiSettingsRowToDomain(row())).toEqual({
      text: 'claude_cli',
      image: 'codex_cli',
      video: 'local',
    })
  })

  /** 名前を消した AI が残っていても、毎回の読み込みで落とさない。選び直してもらう。 */
  it('知らない AI の名前が残っていたら、まだ選んでいない扱いにする', () => {
    expect(aiSettingsRowToDomain(row({ textTool: 'chatgpt' }))).toBeNull()
  })

  it('2 行目を作れない（id は決まった 1 つだけ）', () => {
    const checks = getTableConfig(aiSettings).checks
    expect(checks).toHaveLength(1)
    const sql = new PgDialect().sqlToQuery(checks[0]?.value ?? ({} as never)).sql
    expect(sql).toContain(`'${AI_SETTINGS_ROW_ID}'`)
  })
})
