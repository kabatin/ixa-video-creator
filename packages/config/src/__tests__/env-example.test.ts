import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { describe, expect, it } from 'vitest'
import { configProblems, loadConfig } from '../load.js'

/**
 * 配る設定の見本は 2 つ（ADR-0068）。
 * - `.env.example` … 最初に要るものだけ。`pnpm ixa setup` がそのまま写す
 * - `.env.full.example` … 全部の設定の一覧（参照用）。要る行を `.env` へ写す
 *
 * 書いていない名前は zod の既定で動く。ここでは本物の読み込み口（loadConfig）に通して確かめる。
 */

const read = (name: string): string => readFileSync(new URL(`../../../../${name}`, import.meta.url), 'utf8')
const MINIMAL = read('.env.example')
const FULL = read('.env.full.example')

/** setup が作って入れる値（署名の鍵）。見本では空で配る。 */
const SECRET = { STORAGE_SIGNING_SECRET: 'a'.repeat(64) }

const keysOf = (content: string): readonly string[] => Object.keys(parseEnv(content))

/** 最小の見本に置いてよい項目の数の上限。増やすなら `.env.full.example` で足りないか先に考える。 */
const MAX_MINIMAL_KEYS = 20

describe('.env.example（最小）と .env.full.example（全部）', () => {
  it('最小の見本を写し、署名の鍵だけ入れた .env は本物の読み込み口を通る', () => {
    const env = { ...parseEnv(MINIMAL), ...SECRET }
    expect(configProblems(env)).toEqual([])
    expect(() => loadConfig(env)).not.toThrow()
  })

  it('全部の見本も同じく通る', () => {
    const env = { ...parseEnv(FULL), ...SECRET }
    expect(configProblems(env)).toEqual([])
    expect(() => loadConfig(env)).not.toThrow()
  })

  it('最小の見本の名前は全部、全部の見本にもある（片方だけ直したズレを止める）', () => {
    const full = new Set(keysOf(FULL))
    expect(keysOf(MINIMAL).filter((key) => !full.has(key))).toEqual([])
  })

  it('最小の見本は小さいまま（全部の一覧に戻っていない）', () => {
    expect(keysOf(MINIMAL).length).toBeLessThanOrEqual(MAX_MINIMAL_KEYS)
    expect(keysOf(FULL).length).toBeGreaterThan(MAX_MINIMAL_KEYS)
  })

  it('zod に無いのに 2 つの処理が揃える名前（音の置き場・ポート）は最小の見本にも残す', () => {
    // AUDIO_ROOT は worker と apps/audio で既定が違う（/tmp/ixa-audio と cwd）。書かないと曲の解析が通らない。
    expect(keysOf(MINIMAL)).toEqual(expect.arrayContaining(['AUDIO_ROOT', 'AUDIO_PORT', 'AUDIO_SERVICE_URL']))
  })

  it('2 つの処理が揃える値は、名前があるだけでなく揃っている（どちらの見本も）', () => {
    for (const content of [MINIMAL, FULL]) {
      const env = parseEnv(content)
      // 空の AUDIO_ROOT= は worker では '' のまま（`?? '/tmp/ixa-audio'` は空を拾わない）、apps/audio では cwd になり食い違う。
      expect(env['AUDIO_ROOT'] ?? '').toMatch(/^\/\S+/)
      expect(new URL(env['AUDIO_SERVICE_URL'] ?? 'http://x').port).toBe(env['AUDIO_PORT'])
      expect(new URL(env['NEXT_PUBLIC_API_URL'] ?? 'http://x').port).toBe(env['API_PORT'])
    }
  })

  it('必須の名前を最小の見本から消すと読み込みが止まる（上の検査が素通りしていない）', () => {
    const withoutDb = MINIMAL.replace(/^DATABASE_URL=.*$/m, '')
    expect(withoutDb).not.toBe(MINIMAL)
    const env = { ...parseEnv(withoutDb), ...SECRET }
    expect(configProblems(env).some((p) => p.startsWith('DATABASE_URL'))).toBe(true)
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/)
  })
})
