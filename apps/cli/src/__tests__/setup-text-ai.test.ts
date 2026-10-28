import { describe, expect, it } from 'vitest'
import { addToListValue, parseEnvFile, setEnvValue } from '../lib/env-file.js'
import { paths } from '../lib/repo.js'
import {
  claudeSignIn,
  codexSignIn,
  grokSignIn,
  judgeTextAi,
  textAiEnvSwitches,
  textAiStep,
  type TextAiFact,
} from '../setup/text-ai.js'
import type { RunResult, System } from '../system.js'
import { done, fakeSystem } from './fake-system.js'

/** テキストの AI の手順（ADR-0065）。**実 CLI は叩かない。** サインインはお金も利用枠も使わない口だけで見る。 */

const repo = paths('/r')
const EMAIL = 'someone@example.com'
const failed = (stdout: string, exitCode = 1): RunResult => ({ kind: 'completed', exitCode, stdout, stderr: '' })

/** `.env` を持つ偽の口。書いた中身を返す。 */
const withEnv = (initial: string, answers: Readonly<Record<string, RunResult>>, overrides: Partial<System> = {}) => {
  const files = new Map<string, string>([[repo.env, initial]])
  const system = fakeSystem(answers, {
    readText: (file) => Promise.resolve(files.get(file) ?? null),
    writeText: (file, content) => {
      files.set(file, content)
      return Promise.resolve()
    },
    ...overrides,
  })
  return { system, env: () => files.get(repo.env) ?? '' }
}

const allSignedIn: Readonly<Record<string, RunResult>> = {
  'claude --version': done('2.1.289 (Claude Code)'),
  'claude auth status --json': done(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: EMAIL })),
  'codex --version': done('codex-cli 0.154.0'),
  'codex login status': done('Logged in using ChatGPT'),
  'grok --version': done('grok 0.2.102'),
}

describe('.env の書き方', () => {
  it('setEnvValue は書いてある行の値を入れ替え、無ければ足す。# の行は触らない', () => {
    const content = '# STORYBOARD_DRAFTER=old\nSTORYBOARD_DRAFTER=stub\nOTHER=1\n'
    expect(setEnvValue(content, 'STORYBOARD_DRAFTER', 'claude_cli')).toBe('# STORYBOARD_DRAFTER=old\nSTORYBOARD_DRAFTER=claude_cli\nOTHER=1\n')
    expect(setEnvValue('A=1', 'B', '2')).toBe('A=1\nB=2\n')
    expect(setEnvValue('\n\nGEMINI_API_BILLING=free\n', 'GEMINI_API_BILLING', 'paid')).toBe('\n\nGEMINI_API_BILLING=paid\n')
  })

  it('addToListValue は重ねず、空の項目と空白を落とす', () => {
    expect(addToListValue('', 'gemini_api')).toBe('gemini_api')
    expect(addToListValue(' elevenlabs , ', 'gemini_api')).toBe('elevenlabs,gemini_api')
    expect(addToListValue('gemini_api,elevenlabs', 'gemini_api')).toBe('gemini_api,elevenlabs')
  })
})

describe('サインインの見方', () => {
  it('Claude は auth status の loggedIn を見る。形が違えば分からない', () => {
    expect(claudeSignIn(done('{"loggedIn":true}'))).toBe('signed_in')
    expect(claudeSignIn(failed('{"loggedIn":false}'))).toBe('signed_out')
    expect(claudeSignIn(failed('error: unknown command auth'))).toBe('unknown')
    expect(claudeSignIn({ kind: 'timeout' })).toBe('unknown')
  })

  it('Codex は login status の終了コードを見る', () => {
    expect(codexSignIn(done('Logged in using ChatGPT'))).toBe('signed_in')
    expect(codexSignIn(failed('Not logged in'))).toBe('signed_out')
    expect(codexSignIn(failed('boom'))).toBe('unknown')
  })

  it('Grok は auth.json に記録があるかだけを見る', () => {
    expect(grokSignIn('{"https://auth.x.ai::abc":{"token":"x"}}')).toBe('signed_in')
    expect(grokSignIn('{}')).toBe('signed_out')
    expect(grokSignIn(null)).toBe('signed_out')
    expect(grokSignIn('not json')).toBe('unknown')
  })
})

describe('judgeTextAi', () => {
  it('無ければ止めずに入れ方を出す（人が入れる）', () => {
    const result = judgeTextAi({ id: 'claude', installed: false, signIn: 'unknown' })
    expect(result).toMatchObject({ status: 'notice', fix: { needsHuman: true, command: 'npm install -g @anthropic-ai/claude-code' } })
    expect(result.message).toMatch(/AI エージェントのタブ/)
  })

  it('サインインしていなければサインインの 1 行を出す', () => {
    expect(judgeTextAi({ id: 'codex', installed: true, signIn: 'signed_out' })).toMatchObject({
      status: 'notice',
      fix: { command: 'codex login', needsHuman: true },
    })
  })

  it('Grok は記録があるだけで有効かは分からないと言う', () => {
    expect(judgeTextAi({ id: 'grok', installed: true, signIn: 'signed_in' }).message).toMatch(/有効かは使うまで分かりません/)
  })
})

describe('textAiEnvSwitches', () => {
  const claude: TextAiFact = { id: 'claude', installed: true, signIn: 'signed_in' }
  const codex: TextAiFact = { id: 'codex', installed: true, signIn: 'unknown' }

  it('既定（stub・空）のときだけ、入っている AI に切り替える', () => {
    expect(textAiEnvSwitches([claude, codex], parseEnvFile('STORYBOARD_DRAFTER=stub\nIMAGE_PROVIDER=\n'))).toEqual([
      expect.objectContaining({ key: 'STORYBOARD_DRAFTER', value: 'claude_cli' }),
      expect.objectContaining({ key: 'IMAGE_PROVIDER', value: 'codex_cli' }),
    ])
  })

  it('制作者が書いた値は触らない。サインインしていない AI には切り替えない', () => {
    expect(textAiEnvSwitches([claude], parseEnvFile('STORYBOARD_DRAFTER=claude_cli\n'))).toEqual([])
    expect(textAiEnvSwitches([{ ...claude, signIn: 'signed_out' }], parseEnvFile('STORYBOARD_DRAFTER=stub\n'))).toEqual([])
    expect(textAiEnvSwitches([{ ...claude, installed: false }], parseEnvFile(''))).toEqual([])
  })
})

describe('textAiStep', () => {
  it('--yes なら聞かずに .env を切り替える。メールアドレスはどこにも出さない', async () => {
    const { system, env } = withEnv('STORYBOARD_DRAFTER=stub\nIMAGE_PROVIDER=stub\n', allSignedIn)
    const results = await textAiStep({ system, repo, yes: true })
    expect(parseEnvFile(env())).toMatchObject({ STORYBOARD_DRAFTER: 'claude_cli', IMAGE_PROVIDER: 'codex_cli' })
    expect(results.find((r) => r.id === 'text-ai.env')).toMatchObject({ status: 'done' })
    expect(results.map((r) => r.status)).not.toContain('needs_human')
    expect(JSON.stringify(results)).not.toContain(EMAIL)
  })

  it('聞いて「いいえ」なら書かずに知らせる（止めない）', async () => {
    const { system, env } = withEnv('STORYBOARD_DRAFTER=stub\n', allSignedIn, { confirm: () => Promise.resolve(false) })
    const results = await textAiStep({ system, repo, yes: false })
    expect(env()).toBe('STORYBOARD_DRAFTER=stub\n')
    expect(results.find((r) => r.id === 'text-ai.env')).toMatchObject({ status: 'notice' })
  })

  it('何も入っていなければ 3 つとも入れ方を出し、.env は触らない', async () => {
    const { system, env } = withEnv('STORYBOARD_DRAFTER=stub\n', {})
    const results = await textAiStep({ system, repo, yes: true })
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['text-ai.claude', 'notice'],
      ['text-ai.codex', 'notice'],
      ['text-ai.grok', 'notice'],
    ])
    expect(env()).toBe('STORYBOARD_DRAFTER=stub\n')
  })
})
