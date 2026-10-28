import type { Options } from '../args.js'
import { expectedPnpmVersion, parseRootPackage, portsOf, WEB_PORT, type RepoPaths } from '../lib/repo.js'
import type { Output } from '../printer.js'
import { runSteps, type Step } from '../setup/run-steps.js'
import {
  audioDepsStep,
  envFileStep,
  envValidStep,
  infraStep,
  migrateStep,
  readEnv,
  seedStep,
  signingSecretStep,
  toolsStep,
  type SetupContext,
} from '../setup/steps.js'
import { geminiStep } from '../setup/gemini.js'
import { mcpStep } from '../setup/mcp-step.js'
import { remotionBrowserStep } from '../setup/render-browser.js'
import { textAiStep } from '../setup/text-ai.js'
import type { System } from '../system.js'
import { hasFailure, isStopping } from '../types.js'
import { finalDoctor } from './doctor.js'

/**
 * `pnpm ixa setup`（ADR-0063）。道具 → `.env` → Docker → DB の更新 → 初期データ → 音の解析の依存 →
 * テキストの AI → Gemini の鍵 → 書き出しの headless Chrome → MCP の登録（ADR-0065。どれも止めない）→ doctor。
 * 止まる手順があればそこで止め、直し方を出す（それより先は回さない）。
 */

export const nextSteps = (apiPort: number): readonly string[] => [
  `pnpm dev を起動して http://localhost:${String(WEB_PORT)} を開く（API は :${String(apiPort)}）`,
  'Claude Code / Codex から使うなら: pnpm ixa mcp --claude（または --codex）',
]

export const setupCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const rootPackage = parseRootPackage((await system.readText(repo.rootPackage)) ?? '{}')
  const ctx: SetupContext = { system, repo, yes: options.yes }
  out.line('ixa の導入（pnpm ixa setup）\n')
  const steps: readonly Step<SetupContext>[] = [
    (c) => toolsStep(c, expectedPnpmVersion(rootPackage)),
    envFileStep,
    signingSecretStep,
    async (c) => envValidStep(await readEnv(c.system, c.repo)),
    async (c) => infraStep(c, await readEnv(c.system, c.repo)),
    async (c) => migrateStep(c, await readEnv(c.system, c.repo)),
    async (c) => seedStep(c, await readEnv(c.system, c.repo)),
    audioDepsStep,
    textAiStep,
    geminiStep,
    remotionBrowserStep,
    mcpStep,
  ]
  const results = await runSteps(ctx, steps, out, 'pnpm -s ixa setup')
  const stopped = results.some(isStopping)
  const checks = stopped ? [] : await finalDoctor(system, repo, out)
  const ok = !stopped && !hasFailure(checks)
  const next = ok ? nextSteps(portsOf(await readEnv(system, repo)).api) : []
  if (stopped) out.line('\n止まりました。上の「直し方」を済ませてから、もう一度 pnpm ixa setup を実行してください。')
  if (ok) out.line(`\n次の 1 手:\n${next.map((line) => `  ${line}`).join('\n')}`)
  out.result({ command: 'setup', ok, steps: results, results: checks, next })
  return ok ? 0 : 1
}
