import { mcpTargetOf, tokenHint, writeClaude } from '../commands/mcp.js'
import { parseEnvFile } from '../lib/env-file.js'
import type { StepResult } from '../types.js'
import type { SetupContext } from './steps.js'

/**
 * setup の最後: Claude Code に ixa の MCP を登録するか（ADR-0065）。**止めない。**
 * - 端末で `--yes` でないときだけ聞き、「はい」なら `pnpm ixa mcp --claude --write` と同じ登録をする。
 * - `--yes`・端末でないときは書かずに、打つ 1 行を返す（ユーザーの設定を書くかは制作者が決める）。
 * - アクセス用の鍵（IXA_API_TOKEN）は作らない。発行は今までどおり画面で制作者が押す（場所を言う）。
 */

const ID = 'mcp.claude'
const WRITE_COMMAND = 'pnpm ixa mcp --claude --write'

/** 止める印（needs_human・failed）を、止めない知らせに替える（登録は任意。doctor まで進める）。 */
const asNotice = (step: StepResult): StepResult =>
  step.status === 'needs_human' || step.status === 'failed' ? { ...step, status: 'notice' } : step

export const mcpStep = async ({ system, repo, yes }: SetupContext): Promise<readonly StepResult[]> => {
  const target = mcpTargetOf(repo, parseEnvFile((await system.readText(repo.env)) ?? ''))
  if (target === null) return [{ id: ID, status: 'skipped', message: 'ワークスペースの ID が無いので、MCP の登録は飛ばしました' }]
  const existing = await system.run('claude', ['mcp', 'get', 'ixa'], { timeoutMs: 15_000 })
  if (existing.kind === 'not_found') {
    return [{ id: ID, status: 'skipped', message: 'Claude Code が無いので、MCP の登録は飛ばしました（入れたら pnpm ixa mcp --claude）' }]
  }
  if (existing.kind === 'completed' && existing.exitCode === 0) {
    return [{ id: ID, status: 'already', message: 'Claude Code に ixa の MCP はもう登録されています' }]
  }
  const ask = !yes && system.isTty
  if (!ask || !(await system.confirm('Claude Code に ixa の MCP を登録しますか（ユーザーの設定に足します）'))) {
    return [
      {
        id: ID,
        status: 'notice',
        message: ask ? 'Claude Code への MCP の登録はしませんでした' : 'Claude Code への MCP の登録は聞かずに飛ばしました（ユーザーの設定を書くかは制作者が決める）',
        fix: { hint: '登録するなら次の 1 行（何度打っても壊れない）', command: WRITE_COMMAND, needsHuman: true },
        docs: 'apps/mcp/README.md',
      },
    ]
  }
  return [asNotice(await writeClaude(system, target)), asNotice(tokenHint())]
}
