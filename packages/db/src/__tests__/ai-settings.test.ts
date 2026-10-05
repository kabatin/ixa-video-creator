import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    voiceTool: 'macos_say',
    transcribeTool: 'whisper_cpp',
    updatedAt: new Date('2026-09-30T00:00:00Z'),
    ...patch,
  })

  it('行を用途ごとの選択にする', () => {
    expect(aiSettingsRowToDomain(row())).toEqual({
      text: 'claude_cli',
      image: 'codex_cli',
      video: 'local',
      voice: 'macos_say',
      transcribe: 'whisper_cpp',
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

  /**
   * 声と文字起こし（ADR-0038）。**列を足しても、保存済みの選択を消さない。**
   * 既定値の無い列を足すと、既にある 1 行が NOT NULL を満たせずマイグレーションが落ちる（または
   * 読み込みで AiSettings に合わず「まだ選んでいない」に戻る）。お試し（stub）を既定にする。
   */
  it('声と文字起こしの列は、既定値がお試し（stub）', () => {
    const columns = getTableConfig(aiSettings).columns
    for (const name of ['voice_tool', 'transcribe_tool']) {
      const column = columns.find((c) => c.name === name)
      expect(column?.notNull).toBe(true)
      expect(column?.default).toBe('stub')
    }
  })

  it('列を足すマイグレーションに既定値が入っている（既にある行がそのまま読める）', () => {
    const dir = fileURLToPath(new URL('../../drizzle/', import.meta.url))
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(`${dir}${name}`, 'utf8'))
      .join('\n')
    expect(sql).toMatch(/ADD COLUMN "voice_tool" text DEFAULT 'stub' NOT NULL/)
    expect(sql).toMatch(/ADD COLUMN "transcribe_tool" text DEFAULT 'stub' NOT NULL/)
  })
})
