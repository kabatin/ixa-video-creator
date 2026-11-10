import { describe, expect, it } from 'vitest'
import { lockStateOf } from '../start/build-lock.js'
import {
  buildDecision,
  effectivePublicEnv,
  parseBuildRecord,
  publicEnvHashOf,
  staleReasonText,
  type PublicEnvSources,
} from '../start/build-record.js'

/** `pnpm ixa start` の組み立て直しの判定と、組み立て中の印（ADR-0068。どれも純粋）。 */

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)
const EMPTY: PublicEnvSources = { processEnv: {}, webEnvProductionLocal: {}, webEnvLocal: {}, webEnvProduction: {}, webEnv: {}, rootEnv: {} }

describe('buildDecision（画面を組み立て直すか）', () => {
  const publicEnv = publicEnvHashOf({ ...EMPTY, rootEnv: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001' } })
  const found = { kind: 'found', record: { commit: COMMIT_A, publicEnv } } as const
  const current = { commit: COMMIT_A, publicEnv }

  it('記録が無い・読めないなら組み立てる（理由は分けて言う）', () => {
    expect(buildDecision({ record: { kind: 'missing' }, current, force: false })).toEqual({ kind: 'stale', reason: 'missing' })
    expect(buildDecision({ record: { kind: 'unreadable' }, current, force: false })).toEqual({ kind: 'stale', reason: 'unreadable' })
    expect(staleReasonText('unreadable')).toContain('読めません')
  })

  it('同じ版・同じ画面の設定なら組み立てない', () => {
    expect(buildDecision({ record: found, current, force: false })).toEqual({ kind: 'fresh' })
  })

  it('版が違う・画面の設定が違う・--build・版が分からない、なら組み立てる', () => {
    expect(buildDecision({ record: found, current: { ...current, commit: COMMIT_B }, force: false })).toEqual({ kind: 'stale', reason: 'commit' })
    const other = publicEnvHashOf({ ...EMPTY, rootEnv: { NEXT_PUBLIC_API_URL: 'http://mac.local:3001' } })
    expect(buildDecision({ record: found, current: { ...current, publicEnv: other }, force: false })).toEqual({ kind: 'stale', reason: 'public-env' })
    expect(buildDecision({ record: found, current, force: true })).toEqual({ kind: 'stale', reason: 'forced' })
    expect(buildDecision({ record: found, current: { ...current, commit: null }, force: false })).toEqual({ kind: 'stale', reason: 'unknown-commit' })
  })
})

describe('parseBuildRecord', () => {
  it('無い・JSON でない・形が違う・正しい、を見分ける', () => {
    expect(parseBuildRecord(null)).toEqual({ kind: 'missing' })
    expect(parseBuildRecord('{')).toEqual({ kind: 'unreadable' })
    expect(parseBuildRecord(JSON.stringify({ commit: 'main', publicEnv: 'x' }))).toEqual({ kind: 'unreadable' })
    const record = { commit: COMMIT_A, publicEnv: 'c'.repeat(64) }
    expect(parseBuildRecord(JSON.stringify(record))).toEqual({ kind: 'found', record })
  })
})

describe('effectivePublicEnv（next build が焼き込む NEXT_PUBLIC_*）', () => {
  const ORDER: readonly (keyof PublicEnvSources)[] = ['processEnv', 'webEnvProductionLocal', 'webEnvLocal', 'webEnvProduction', 'webEnv', 'rootEnv']

  it('強い順（環境 → .env.production.local → .env.local → .env.production → apps/web/.env → 直下の .env）に、どれも下のものに勝つ', () => {
    ORDER.forEach((winner, i) => {
      const sources = ORDER.slice(i).reduce<PublicEnvSources>(
        (acc, name) => ({ ...acc, [name]: { NEXT_PUBLIC_API_URL: `from-${name}` } }),
        EMPTY,
      )
      expect(effectivePublicEnv(sources)).toEqual({ NEXT_PUBLIC_API_URL: `from-${winner}` })
    })
  })

  it('空の値も「決めた」に数える（Next も loadEnvFile も上書きしない）', () => {
    expect(effectivePublicEnv({ ...EMPTY, processEnv: { NEXT_PUBLIC_API_URL: '' }, rootEnv: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001' } })).toEqual({
      NEXT_PUBLIC_API_URL: '',
    })
  })

  it('NEXT_PUBLIC_* だけを見る。指紋は並び順で変わらず、値が変われば変わる', () => {
    const base = publicEnvHashOf({ ...EMPTY, rootEnv: { NEXT_PUBLIC_A: '1', NEXT_PUBLIC_B: '2', DATABASE_URL: 'x' } })
    expect(publicEnvHashOf({ ...EMPTY, rootEnv: { NEXT_PUBLIC_B: '2', NEXT_PUBLIC_A: '1', DATABASE_URL: 'y' } })).toBe(base)
    expect(publicEnvHashOf({ ...EMPTY, processEnv: { NEXT_PUBLIC_B: '3' }, rootEnv: { NEXT_PUBLIC_A: '1', NEXT_PUBLIC_B: '2' } })).not.toBe(base)
  })
})

describe('lockStateOf（組み立て中の印）', () => {
  const lock = { pid: 77, startedAt: '2026-11-10T09:00:00.000Z' }

  it('無い・生きた持ち主・死んだ持ち主・読めない、を見分ける（死んだ・読めないは理由つき）', () => {
    expect(lockStateOf(null, () => true)).toEqual({ kind: 'none' })
    expect(lockStateOf(JSON.stringify(lock), (pid) => pid === 77)).toEqual({ kind: 'held', lock })
    const whyOf = (state: ReturnType<typeof lockStateOf>): string => (state.kind === 'stale' ? state.why : `stale ではない: ${state.kind}`)
    expect(whyOf(lockStateOf(JSON.stringify(lock), () => false))).toContain('pid 77')
    expect(whyOf(lockStateOf('{', () => true))).toContain('読めません')
    expect(lockStateOf(JSON.stringify({ pid: -1, startedAt: 'yesterday' }), () => true)).toMatchObject({ kind: 'stale' })
  })
})
