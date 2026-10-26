import { configProblems } from '@ixa/config'
import { missingEnvKeys, parseEnvFile, webLocalOverrides } from '../lib/env-file.js'
import type { RepoPaths } from '../lib/repo.js'
import type { System } from '../system.js'
import type { CheckResult } from '../types.js'

/**
 * 設定の点検。**値は出さない**（変数の名前だけ）。
 * `configProblems` の文も名前しか含まない（packages/config の作法）。
 */

export type EnvFacts = {
  readonly envContent: string | null
  readonly exampleContent: string | null
  readonly webLocalContent: string | null
}

const DOCS = 'INSTALL.md#設定'

/** setup が自分で直せる問題（署名の鍵が空）。それ以外は人が決める（課金の鍵など）。 */
const SETUP_FIXABLE = ['STORAGE_SIGNING_SECRET']

const validityCheck = (envContent: string): CheckResult => {
  const problems = configProblems(parseEnvFile(envContent))
  if (problems.length === 0) return { id: 'env.valid', group: 'env', level: 'ok', message: '設定の検査を通りました' }
  const setupCanFix = problems.every((p) => SETUP_FIXABLE.some((name) => p.includes(name)))
  return {
    id: 'env.valid',
    group: 'env',
    level: 'fail',
    message: `設定に問題があります: ${problems.join(' / ')}`,
    fix: setupCanFix
      ? { hint: '署名の鍵を作って入れる（値は表示しない）', command: 'pnpm ixa setup', needsHuman: false }
      : { hint: '.env の書いた名前を直す。課金の鍵を入れるかは制作者に聞く', needsHuman: true },
    docs: DOCS,
  }
}

const newKeysCheck = (exampleContent: string, envContent: string): CheckResult => {
  const missing = missingEnvKeys(exampleContent, envContent)
  return missing.length === 0
    ? { id: 'env.new-keys', group: 'env', level: 'ok', message: '.env.example の項目は全部 .env にあります' }
    : {
        id: 'env.new-keys',
        group: 'env',
        level: 'warn',
        message: `.env.example にあって .env に無い項目: ${missing.join(', ')}`,
        fix: {
          hint: '.env.example の説明を読み、要るものだけ .env に足す（無ければ既定で動く。鍵は制作者に聞く）',
          needsHuman: false,
        },
        docs: DOCS,
      }
}

const webLocalCheck = (envContent: string, webLocalContent: string | null): CheckResult => {
  if (webLocalContent === null) {
    return { id: 'env.web-local', group: 'env', level: 'ok', message: 'apps/web/.env.local はありません（直下の .env を使う）' }
  }
  const overrides = webLocalOverrides(parseEnvFile(envContent), parseEnvFile(webLocalContent))
  return overrides.length === 0
    ? { id: 'env.web-local', group: 'env', level: 'ok', message: 'apps/web/.env.local は .env と食い違っていません' }
    : {
        id: 'env.web-local',
        group: 'env',
        level: 'warn',
        message: `apps/web/.env.local が .env と違う値で上書きしています: ${overrides.join(', ')}`,
        fix: { hint: 'apps/web/.env.local の該当行を消すか、.env と揃える', needsHuman: false },
        docs: DOCS,
      }
}

/** 判定（純粋）。 */
export const judgeEnv = (facts: EnvFacts): readonly CheckResult[] => {
  if (facts.envContent === null) {
    return [
      {
        id: 'env.file',
        group: 'env',
        level: 'fail',
        message: '.env がありません',
        fix: { hint: '.env.example から作り、署名の鍵を入れる', command: 'pnpm ixa setup', needsHuman: false },
        docs: DOCS,
      },
    ]
  }
  return [
    { id: 'env.file', group: 'env', level: 'ok', message: '.env があります' },
    validityCheck(facts.envContent),
    ...(facts.exampleContent === null ? [] : [newKeysCheck(facts.exampleContent, facts.envContent)]),
    webLocalCheck(facts.envContent, facts.webLocalContent),
  ]
}

export const gatherEnv = async (system: System, repo: RepoPaths): Promise<EnvFacts> => ({
  envContent: await system.readText(repo.env),
  exampleContent: await system.readText(repo.envExample),
  webLocalContent: await system.readText(repo.webEnvLocal),
})
