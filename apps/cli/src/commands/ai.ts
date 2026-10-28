import type { Options } from '../args.js'
import { connectCodeChanges } from '../ai/contract.js'
import { writeEnvStep } from '../ai/write-env.js'
import { gatherLocalAi, judgeLocalAi } from '../checks/local-ai.js'
import type { RepoPaths } from '../lib/repo.js'
import { formatChecks, formatStep, summarize, type Output } from '../printer.js'
import { readEnv } from '../setup/steps.js'
import type { System } from '../system.js'
import { hasFailure, isStopping, type StepResult } from '../types.js'
import { aiInstallCommand } from './ai-install.js'
import { finalDoctor } from './doctor.js'

/**
 * `pnpm ixa ai install | connect | status`（ADR-0064）。
 * **接続コードと合言葉はどこにも出さない**（表示も `--json` も、書いた名前だけ）。
 */

const CONNECT_RETRY = 'pnpm ixa ai connect'

const NO_CODE_STEP: StepResult = {
  id: 'ai.connect.code',
  status: 'needs_human',
  message: '接続コードを受け取れませんでした',
  fix: { hint: '制作者が端末で打ち、別の Mac に出た接続コードを貼る（画面には出ません）', command: CONNECT_RETRY, needsHuman: true },
  docs: 'INSTALL.md#手元の生成-ai',
}

/**
 * 接続コードを受け取る。引数に無ければ、端末では画面に出さずに聞き、端末でなければ stdin から読む
 * （引数は ps やシェルの履歴に残るので、聞く形を勧める。ADR-0064）。
 */
const receiveCode = async (system: System, options: Options): Promise<string | null> =>
  options.code ??
  (await system.promptSecret('別の Mac に出た接続コード（画面には出ません。貼り付けて Enter）: ')) ??
  (await system.readStdin())

export const aiConnectCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const code = await receiveCode(system, options)
  const steps =
    code === null || code.trim() === ''
      ? [NO_CODE_STEP]
      : await writeEnvStep(system, repo, connectCodeChanges(code), options.overwriteEnv, CONNECT_RETRY)
  steps.forEach((s) => out.line(formatStep(s)))
  const ok = !steps.some(isStopping)
  const results = steps.some((s) => s.status === 'done') ? await finalDoctor(system, repo, out) : []
  out.result({ command: 'ai', action: 'connect', ok, steps, results })
  return ok ? 0 : 1
}

/** 手元の AI サーバーの点検だけ（doctor の「手元の AI サーバー」と同じもの）。読むだけ。 */
export const aiStatusCommand = async (system: System, repo: RepoPaths, out: Output): Promise<number> => {
  const results = judgeLocalAi(await gatherLocalAi(system, await readEnv(system, repo)))
  out.line(formatChecks(results))
  out.line(summarize(results))
  out.result({ command: 'ai', action: 'status', ok: !hasFailure(results), results })
  return hasFailure(results) ? 1 : 0
}

export const aiCommand = (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  switch (options.action) {
    case 'connect':
      return aiConnectCommand(system, repo, out, options)
    case 'status':
      return aiStatusCommand(system, repo, out)
    default:
      return aiInstallCommand(system, repo, out, options)
  }
}
