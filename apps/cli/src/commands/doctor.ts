import { runChecks } from '../checks/index.js'
import type { RepoPaths } from '../lib/repo.js'
import { formatChecks, summarize, type Output } from '../printer.js'
import type { System } from '../system.js'
import { hasFailure, type CheckResult } from '../types.js'

/** `pnpm ixa doctor`。読むだけ。✗ があれば終了コード 1。 */
export const doctorCommand = async (system: System, repo: RepoPaths, out: Output): Promise<number> => {
  const results = await runChecks(system, repo)
  out.line(formatChecks(results))
  out.line(summarize(results))
  out.result({ command: 'doctor', ok: !hasFailure(results), results })
  return hasFailure(results) ? 1 : 0
}

/** setup・update の最後に回す doctor（表示だけ。答えの JSON には results として入れる）。 */
export const finalDoctor = async (
  system: System,
  repo: RepoPaths,
  out: Output,
): Promise<readonly CheckResult[]> => {
  const results = await runChecks(system, repo)
  out.line('\n— 点検（pnpm ixa doctor）—')
  out.line(formatChecks(results))
  out.line(summarize(results))
  return results
}
