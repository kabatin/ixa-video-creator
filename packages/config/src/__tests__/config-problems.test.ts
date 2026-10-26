import { describe, expect, it } from 'vitest'
import { configProblems } from '../load.js'

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
