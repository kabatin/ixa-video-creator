import path from 'node:path'
import { z } from 'zod'
import { isBlank, parseEnvFile, setEnvValue, type EnvValues } from '../lib/env-file.js'
import type { RunResult, System } from '../system.js'
import type { StepResult } from '../types.js'
import type { SetupContext } from './steps.js'

/**
 * テキストの AI（Claude Code・Codex・Grok。ADR-0065）が入っているか・サインイン済みかを見る。
 *
 * **サインインの見方はお金も利用枠も使わない口だけ**（AI に何も頼まない）:
 * - Claude Code: `claude auth status --json` の `loggedIn`（メールアドレスなどは読まない・出さない）
 * - Codex: `codex login status` の終了コード
 * - Grok: 確かめる口が無いので、`~/.grok/auth.json` に記録があるかだけ（中身は数えるだけ。有効かは使うまで分からない）
 */

export type TextAiId = 'claude' | 'codex' | 'grok'
export type SignIn = 'signed_in' | 'signed_out' | 'unknown'

export type TextAiFact = {
  readonly id: TextAiId
  readonly installed: boolean
  readonly signIn: SignIn
}

type TextAiSpec = {
  readonly id: TextAiId
  readonly label: string
  /** これが無いと動かないもの。 */
  readonly purpose: string
  readonly installHint: string
  readonly installCommand?: string
  readonly loginCommand: string
}

export const TEXT_AI_SPECS: readonly TextAiSpec[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    purpose: 'AI エージェントのタブ・絵コンテの案・作った画像のチェック・動きの分析・Take の見直しに使う',
    installHint: 'Claude Code を入れてサインインする（https://docs.anthropic.com/en/docs/claude-code）。入れるかは制作者が決める',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude auth login',
  },
  {
    id: 'codex',
    label: 'Codex',
    purpose: '絵コンテの画像と、テキストの控えに使う',
    installHint: 'Codex を入れてサインインする（https://github.com/openai/codex）。入れるかは制作者が決める',
    installCommand: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
  },
  {
    id: 'grok',
    label: 'Grok',
    purpose: 'テキストの控えに使う',
    installHint: 'Grok を入れてサインインする（https://x.ai/cli）。入れるかは制作者が決める',
    installCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    loginCommand: 'grok login',
  },
]

const ClaudeAuthStatus = z.object({ loggedIn: z.boolean() })

const completedOk = (r: RunResult): boolean => r.kind === 'completed' && r.exitCode === 0

/** `claude auth status --json`。古い版で口が無い・形が違うときは「分からない」。 */
export const claudeSignIn = (r: RunResult): SignIn => {
  if (r.kind !== 'completed') return 'unknown'
  try {
    const parsed = ClaudeAuthStatus.safeParse(JSON.parse(r.stdout))
    if (!parsed.success) return 'unknown'
    return parsed.data.loggedIn ? 'signed_in' : 'signed_out'
  } catch {
    return 'unknown'
  }
}

/** `codex login status`。サインインしていなければ終了コードが 0 以外で「Not logged in」と言う。 */
export const codexSignIn = (r: RunResult): SignIn => {
  if (r.kind !== 'completed') return 'unknown'
  if (r.exitCode === 0) return 'signed_in'
  return /not logged in/i.test(`${r.stdout}\n${r.stderr}`) ? 'signed_out' : 'unknown'
}

/** `~/.grok/auth.json` に 1 つでも記録があるか（値は見ない）。 */
export const grokSignIn = (authJson: string | null): SignIn => {
  if (authJson === null) return 'signed_out'
  try {
    const parsed: unknown = JSON.parse(authJson)
    return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0 ? 'signed_in' : 'signed_out'
  } catch {
    return 'unknown'
  }
}

const VERSION_TIMEOUT_MS = 10_000

export const gatherTextAi = async (system: System): Promise<readonly TextAiFact[]> => {
  const version = (command: TextAiId) => system.run(command, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS })
  const [claude, codex, grok] = await Promise.all([version('claude'), version('codex'), version('grok')])
  const [claudeAuth, codexAuth, grokAuth] = await Promise.all([
    completedOk(claude) ? system.run('claude', ['auth', 'status', '--json'], { timeoutMs: VERSION_TIMEOUT_MS }) : null,
    completedOk(codex) ? system.run('codex', ['login', 'status'], { timeoutMs: VERSION_TIMEOUT_MS }) : null,
    completedOk(grok) ? system.readText(path.join(system.homedir, '.grok', 'auth.json')) : null,
  ])
  return [
    { id: 'claude', installed: claudeAuth !== null, signIn: claudeAuth === null ? 'unknown' : claudeSignIn(claudeAuth) },
    { id: 'codex', installed: codexAuth !== null, signIn: codexAuth === null ? 'unknown' : codexSignIn(codexAuth) },
    { id: 'grok', installed: completedOk(grok), signIn: completedOk(grok) ? grokSignIn(grokAuth) : 'unknown' },
  ]
}

/** `.env` の切り替え 1 つ。 */
export type EnvSwitch = { readonly key: string; readonly value: string; readonly why: string }

/** 既定（stub・空）のときだけ切り替える。制作者が書いた値は触らない。 */
const isDefault = (env: EnvValues, key: string): boolean => isBlank(env, key) || (env[key] ?? '').trim() === 'stub'

const usable = (facts: readonly TextAiFact[], id: TextAiId): boolean =>
  facts.some((f) => f.id === id && f.installed && f.signIn !== 'signed_out')

/**
 * 入っている AI に合わせる `.env` の項目（純粋）。まだ画面で選んでいないときの初期値になる（`aiDefaultsFromEnv`）。
 * - Claude Code → `STORYBOARD_DRAFTER=claude_cli`（テキストの初期値。画像のチェック・動きの分析・見直しはテキストが Claude のときに動く）
 * - Codex → `IMAGE_PROVIDER=codex_cli`（画像の初期値）
 */
export const textAiEnvSwitches = (facts: readonly TextAiFact[], env: EnvValues): readonly EnvSwitch[] => [
  ...(usable(facts, 'claude') && isDefault(env, 'STORYBOARD_DRAFTER')
    ? [{ key: 'STORYBOARD_DRAFTER', value: 'claude_cli', why: 'テキストを Claude Code に' }]
    : []),
  ...(usable(facts, 'codex') && isDefault(env, 'IMAGE_PROVIDER')
    ? [{ key: 'IMAGE_PROVIDER', value: 'codex_cli', why: '画像を Codex に' }]
    : []),
]

const SIGN_IN_WORDS: Readonly<Record<SignIn, string>> = {
  signed_in: 'サインイン済み',
  signed_out: 'サインインしていません',
  unknown: 'サインインは確かめられません',
}

const DOCS = 'INSTALL.md#任意'

/** 1 つの AI の結果（純粋）。無い・サインインしていなければ止めずに知らせる（人が入れる・サインインする）。 */
export const judgeTextAi = (fact: TextAiFact): StepResult => {
  const spec = TEXT_AI_SPECS.find((s) => s.id === fact.id)
  if (spec === undefined) throw new Error(`テキストの AI ${fact.id} の表がありません`)
  const id = `text-ai.${fact.id}`
  if (!fact.installed) {
    return {
      id,
      status: 'notice',
      message: `${spec.label} がありません（${spec.purpose}）`,
      fix: { hint: spec.installHint, ...(spec.installCommand === undefined ? {} : { command: spec.installCommand }), needsHuman: true },
      docs: DOCS,
    }
  }
  if (fact.signIn === 'signed_out') {
    return {
      id,
      status: 'notice',
      message: `${spec.label} は入っていますが、サインインしていません（${spec.purpose}）`,
      fix: { hint: '制作者がサインインする（ブラウザが開きます）', command: spec.loginCommand, needsHuman: true },
      docs: DOCS,
    }
  }
  const signIn =
    fact.id === 'grok' && fact.signIn === 'signed_in' ? 'サインインの記録あり。有効かは使うまで分かりません' : SIGN_IN_WORDS[fact.signIn]
  return { id, status: 'already', message: `${spec.label} が入っています（${signIn}）` }
}

/**
 * 切り替えを `.env` に書く。**契約の利用枠を使う口に替えるので、端末で「はい」と答えたときだけ**
 * （`--yes` では聞かずに書かない。Gemini の鍵・MCP の登録と同じく人に頼む）。
 */
const switchEnv = async (ctx: SetupContext, switches: readonly EnvSwitch[]): Promise<StepResult | null> => {
  if (switches.length === 0) return null
  const what = switches.map((s) => s.why).join('・')
  const keys = switches.map((s) => `${s.key}=${s.value}`).join(' ')
  const allowed = !ctx.yes && (await ctx.system.confirm(`まだ選んでいない AI の初期値を ${what}しますか（契約の利用枠を使います）`))
  if (!allowed) {
    return {
      id: 'text-ai.env',
      status: 'notice',
      message: `AI の初期値は変えていません（お試しのまま${ctx.yes ? '。--yes では聞きません' : ''}）。使うなら .env を ${keys} にするか、画面の「使う AI」で選ぶ`,
      fix: { hint: '契約の利用枠を使ってよいか制作者に確かめ、画面の「使う AI」で選ぶか、端末で pnpm ixa setup を回して「はい」と答える', needsHuman: true },
      docs: DOCS,
    }
  }
  const content = (await ctx.system.readText(ctx.repo.env)) ?? ''
  await ctx.system.writeText(ctx.repo.env, switches.reduce((acc, s) => setEnvValue(acc, s.key, s.value), content))
  return { id: 'text-ai.env', status: 'done', message: `AI の初期値を ${what}しました（.env の ${keys}）` }
}

/** テキストの AI の手順。止めない（どれも無くても画面は開ける）。 */
export const textAiStep = async (ctx: SetupContext): Promise<readonly StepResult[]> => {
  const facts = await gatherTextAi(ctx.system)
  const env = parseEnvFile((await ctx.system.readText(ctx.repo.env)) ?? '')
  const switched = await switchEnv(ctx, textAiEnvSwitches(facts, env))
  return [...facts.map(judgeTextAi), ...(switched === null ? [] : [switched])]
}
