import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { describe, expect, it } from 'vitest'
import { configProblems, loadConfig } from '../load.js'

const okEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/ixa',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_SIGNING_SECRET: 'a'.repeat(32),
}

describe('configProblems（設定の問題を全部返す）', () => {
  it('揃っていれば空', () => {
    expect(configProblems(okEnv)).toEqual([])
  })

  it('形の問題は変数ごとに 1 行ずつ、値は出さない', () => {
    const problems = configProblems({ ...okEnv, DATABASE_URL: 'not-a-url-secret', REDIS_URL: undefined })
    expect(problems).toHaveLength(2)
    expect(problems.some((p) => p.startsWith('DATABASE_URL'))).toBe(true)
    expect(problems.some((p) => p.startsWith('REDIS_URL'))).toBe(true)
    expect(problems.join('\n')).not.toContain('not-a-url-secret')
  })

  it('.env.example をそのまま写し、署名の鍵だけ入れた .env は通る（まっさらな clone の形）', () => {
    const example = parseEnv(readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8'))
    expect(configProblems({ ...example, STORAGE_SIGNING_SECRET: 'a'.repeat(64) })).toEqual([])
  })

  it('空の STORAGE_PUBLIC_BASE_URL は「書いていない」と同じ（画面が API を呼ぶ場所に揃う）', () => {
    const config = loadConfig({ ...okEnv, STORAGE_PUBLIC_BASE_URL: '', NEXT_PUBLIC_API_URL: 'http://mac.local:3001' })
    expect(config.storage.publicBaseUrl).toBe('http://mac.local:3001')
    expect(configProblems({ ...okEnv, STORAGE_PUBLIC_BASE_URL: 'not a url' })).toHaveLength(1)
  })

  it('組み合わせの問題は最初の 1 つで止めず、全部返す', () => {
    const problems = configProblems({
      ...okEnv,
      STORAGE_SIGNING_SECRET: undefined,
      AUDIO_API_PROVIDERS: 'gemini_api',
    })
    expect(problems).toHaveLength(2)
    expect(problems.some((p) => p.includes('STORAGE_SIGNING_SECRET'))).toBe(true)
    expect(problems.some((p) => p.includes('GEMINI_API_KEY'))).toBe(true)
  })
})
