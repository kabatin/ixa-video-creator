import path from 'node:path'
import type { Options } from '../args.js'
import { InstallResult, validateInstallEnv, type AiComponent } from '../ai/contract.js'
import { NO_ENV_STEP, writeEnvStep } from '../ai/write-env.js'
import type { RepoPaths } from '../lib/repo.js'
import { formatStep, type Output } from '../printer.js'
import type { System } from '../system.js'
import { isStopping, type StepResult, type StepStatus } from '../types.js'
import { finalDoctor } from './doctor.js'

/**
 * `pnpm ixa ai install [--plan] [--models …] [--accept-licenses …] [--yes] [--overwrite-env]`（ADR-0064）。
 * `--yes` は ixa_ai.py に渡すだけ（ライセンス・ダウンロードの質問を飛ばす）。値の入った `.env` の接続先を
 * 替えるのは `--overwrite-env` だけ（writeEnvStep）。
 * 選ぶ・同意を取る・入れるのは `tools/ixa-ai/ixa_ai.py`（uv で動く。別の Mac でも同じもの）。
 * ここはそれを呼び、答えを `.env` に書き、doctor を回すだけ。`--plan` は何も変えない。
 */

const PLAN_TIMEOUT_MS = 180_000
const UV_FIX = { hint: 'uv を入れる', command: 'curl -LsSf https://astral.sh/uv/install.sh | sh', needsHuman: true } as const

export const aiScriptOf = (repo: RepoPaths): string => path.join(repo.root, 'tools', 'ixa-ai', 'ixa_ai.py')

/** ixa_ai.py の答えを受け取る場所（合言葉は入らない。読んだら消す）。 */
export const resultFileOf = (homedir: string): string => path.join(homedir, '.cache', 'ixa', 'ai-install-result.json')

/** ixa_ai.py に渡す引数（純粋）。 */
export const installArgs = (script: string, resultFile: string, options: Options): readonly string[] => [
  'run',
  script,
  'install',
  '--result-file',
  resultFile,
  ...(options.models === undefined ? [] : ['--models', options.models]),
  ...(options.acceptLicenses === undefined ? [] : ['--accept-licenses', options.acceptLicenses]),
  ...(options.yes ? ['--yes'] : []),
]

/** やり直しの 1 行（選んだものと同意をそのまま付ける。`--overwrite-env` は writeEnvStep が足す）。 */
export const retryOf = (options: Options): string =>
  [
    'pnpm ixa ai install',
    ...(options.models === undefined ? [] : [`--models ${options.models}`]),
    ...(options.acceptLicenses === undefined ? [] : [`--accept-licenses ${options.acceptLicenses}`]),
    ...(options.yes ? ['--yes'] : []),
  ].join(' ')

const STATUS: Readonly<Record<string, StepStatus>> = {
  installed: 'done',
  already: 'already',
  needs_human: 'needs_human',
  skipped: 'skipped',
}

/** サーバーの部品 1 つを手順の結果にする（純粋）。知らない状態は失敗にする（黙って合格にしない）。 */
export const componentStep = (component: AiComponent): StepResult => ({
  id: `ai.${component.id}`,
  status: STATUS[component.status] ?? 'failed',
  message: `${component.id}: ${component.message ?? component.status}`,
  ...(component.fix === undefined ? {} : { fix: component.fix }),
})

/** 答えの全体を手順の並びにする（純粋）。 */
export const resultSteps = (result: InstallResult): readonly StepResult[] => {
  const parts = [...result.servers.flatMap((s) => s.components), ...result.local].map(componentStep)
  if (parts.length > 0 || result.ok) return parts
  return [{ id: 'ai.install', status: result.fix?.needsHuman ? 'needs_human' : 'failed', message: result.message ?? '入れられませんでした', ...(result.fix ? { fix: result.fix } : {}) }]
}

const planCommand = async (system: System, repo: RepoPaths, out: Output): Promise<number> => {
  const script = aiScriptOf(repo)
  if (!out.json) {
    const shown = await system.run('uv', ['run', script, 'plan'], { cwd: repo.root, inherit: 'all' })
    return shown.kind === 'completed' ? shown.exitCode : 1
  }
  const ran = await system.run('uv', ['run', script, 'plan', '--json'], { cwd: repo.root, timeoutMs: PLAN_TIMEOUT_MS })
  const last = ran.kind === 'completed' && ran.exitCode === 0 ? ran.stdout.trim().split('\n').at(-1) : undefined
  if (last === undefined) {
    const fix = ran.kind === 'not_found' ? UV_FIX : { hint: 'uv run tools/ixa-ai/ixa_ai.py plan を手で回して理由を見る', needsHuman: false }
    out.result({ command: 'ai', action: 'plan', ok: false, error: '一覧を出せませんでした', fix })
    return 1
  }
  out.result({ command: 'ai', action: 'plan', ok: true, plan: parseJson(last) })
  return 0
}

const finish = async (
  system: System,
  repo: RepoPaths,
  out: Output,
  steps: readonly StepResult[],
): Promise<number> => {
  const ok = !steps.some(isStopping)
  const results = steps.some((s) => s.id === 'ai.env') ? await finalDoctor(system, repo, out) : []
  out.result({ command: 'ai', action: 'install', ok, steps, results })
  return ok ? 0 : 1
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const readResult = async (system: System, file: string): Promise<InstallResult | null> => {
  const text = await system.readText(file)
  await system.remove(file)
  if (text === null) return null
  const parsed = InstallResult.safeParse(parseJson(text))
  if (!parsed.success) {
    // どこが違うかだけを添える（値は URL・パスのこともあるので出さない）
    const where = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '（全体）'))].join('・')
    throw new Error(`ixa_ai.py の答えの形が違います: ${where}（tools/ixa-ai の版が合っていないかもしれません）`)
  }
  return parsed.data
}

export const aiInstallCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  if (options.plan) return planCommand(system, repo, out)
  if (!(await system.exists(repo.env))) {
    out.line(formatStep(NO_ENV_STEP))
    return finish(system, repo, out, [NO_ENV_STEP])
  }
  const file = resultFileOf(system.homedir)
  await system.remove(file)
  const ran = await system.run('uv', installArgs(aiScriptOf(repo), file, options), { cwd: repo.root, inherit: 'to-stderr' })
  if (ran.kind === 'not_found') {
    const step: StepResult = { id: 'ai.uv', status: 'failed', message: 'uv がありません', fix: UV_FIX }
    out.line(formatStep(step))
    return finish(system, repo, out, [step])
  }
  const result = await readResult(system, file)
  const steps =
    result === null
      ? [{ id: 'ai.install', status: 'failed', message: 'ixa_ai.py が答えを残さずに終わりました（上の出力を見る）' } as const]
      : resultSteps(result)
  const envSteps =
    result === null || Object.keys(result.env).length === 0
      ? []
      : await writeEnvStep(system, repo, validateInstallEnv(result.env), options.overwriteEnv, retryOf(options))
  const all = [...steps, ...envSteps]
  envSteps.forEach((s) => out.line(formatStep(s)))
  return finish(system, repo, out, all)
}
