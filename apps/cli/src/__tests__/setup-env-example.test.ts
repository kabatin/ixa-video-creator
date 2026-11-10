import { readFileSync } from 'node:fs'
import { fillEmptyEnvValue } from '@ixa/db'
import { describe, expect, it } from 'vitest'
import { judgeEnv } from '../checks/env.js'
import { missingEnvKeys, parseEnvFile } from '../lib/env-file.js'
import { paths } from '../lib/repo.js'
import { envFileStep, envValidStep, signingSecretStep } from '../setup/steps.js'
import { fakeSystem } from './fake-system.js'

/**
 * まっさらな clone の setup は、最小の `.env.example`（ADR-0068）を写すところから始まる。
 * 写したあとの手順で `.env` が正しい形になり、doctor が「足りない項目」を言わないことを確かめる。
 */

const read = (name: string): string => readFileSync(new URL(`../../../../${name}`, import.meta.url), 'utf8')
const MINIMAL = read('.env.example')
const FULL = read('.env.full.example')
const repo = paths('/repo')

const withFiles = (initial: Readonly<Record<string, string>>) => {
  const files = new Map<string, string>(Object.entries(initial))
  const system = fakeSystem(
    {},
    {
      readText: (file) => Promise.resolve(files.get(file) ?? null),
      writeText: (file, content) => Promise.resolve(void files.set(file, content)),
    },
  )
  return { system, env: () => files.get(repo.env) ?? null }
}

describe('setup を最小の .env.example から始める', () => {
  it('写して署名の鍵を入れた .env は設定の検査を通り、doctor の点検も全部 ✓', async () => {
    const { system, env } = withFiles({ [repo.envExample]: MINIMAL })
    const ctx = { system, repo, yes: true }
    expect(await envFileStep(ctx)).toMatchObject({ id: 'env.file', status: 'done' })
    expect(env()).toBe(MINIMAL)
    expect(await signingSecretStep(ctx)).toMatchObject({ status: 'done' })
    const written = env() ?? ''
    expect(envValidStep(parseEnvFile(written))).toMatchObject({ id: 'env.valid', status: 'already' })

    // 初期データの手順はワークスペースの ID を空の行に入れる（行が無いと足すが、最小の見本にも行がある）。
    const withWorkspace = fillEmptyEnvValue(written, 'NEXT_PUBLIC_WORKSPACE_ID', '01WORKSPACE')
    expect(withWorkspace).not.toBeNull()
    const results = judgeEnv({ envContent: withWorkspace, exampleContent: MINIMAL, webLocalContent: null })
    expect(results.filter((r) => r.level !== 'ok')).toEqual([])
  })

  it('全部の項目を持つ古い .env の人に、update / doctor は「足りない項目」を言わない', () => {
    expect(missingEnvKeys(MINIMAL, FULL)).toEqual([])
  })

  it('最小の見本の項目を .env から消すと、doctor は名前で知らせる（上の検査が素通りしていない）', () => {
    const withoutAudioRoot = MINIMAL.replace(/^AUDIO_ROOT=.*$/m, '')
    expect(withoutAudioRoot).not.toBe(MINIMAL)
    expect(missingEnvKeys(MINIMAL, withoutAudioRoot)).toEqual(['AUDIO_ROOT'])
  })
})
