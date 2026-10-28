import type { Options } from '../args.js'
import { connectCodeChanges } from '../ai/contract.js'
import { writeEnvStep } from '../ai/write-env.js'
import { gatherLocalAi, judgeLocalAi } from '../checks/local-ai.js'
import type { RepoPaths } from '../lib/repo.js'
import { formatChecks, formatStep, summarize, type Output } from '../printer.js'
import { readEnv } from '../setup/steps.js'
import type { System } from '../system.js'
import { hasFailure, isStopping } from '../types.js'
import { aiInstallCommand } from './ai-install.js'
import { finalDoctor } from './doctor.js'

/**
 * `pnpm ixa ai install | connect | status`（ADR-0064）。
 * **接続コードと合言葉はどこにも出さない**（表示も `--json` も、書いた名前だけ）。
 */

export const aiConnectCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const steps = await writeEnvStep(system, repo, connectCodeChanges(options.code ?? ''), options.yes, 'pnpm ixa ai connect <接続コード>')
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
