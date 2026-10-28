import path from 'node:path'
import type { Options } from '../args.js'
import { isBlank, type EnvValues } from '../lib/env-file.js'
import {
  appendCodexSection,
  claudeAddArgs,
  claudeAddCommand,
  codexHasIxa,
  codexTomlSection,
  type McpTarget,
} from '../lib/mcp-config.js'
import { ACCESS_KEYS_PATH, portsOf, WEB_PORT, type RepoPaths } from '../lib/repo.js'
import { formatStep, type Output } from '../printer.js'
import { readEnv } from '../setup/steps.js'
import type { System } from '../system.js'
import type { StepResult } from '../types.js'

/**
 * `pnpm ixa mcp [--claude|--codex] [--write]`（ADR-0063）。そのまま貼れる登録の 1 行を出す。
 * `--write` を付けたときだけ実際に登録する。**アクセス用の鍵は入れない・作らない**（発行は画面で制作者が押す）。
 */

export const tokenHint = (): StepResult => ({
  id: 'mcp.token',
  status: 'needs_human',
  message: `アクセス用の鍵（IXA_API_TOKEN）は制作者が画面で発行します: http://localhost:${String(WEB_PORT)}${ACCESS_KEYS_PATH}（pnpm dev が動いているとき）`,
  fix: {
    hint: '発行した鍵はシェルの環境に置く（例 ~/.zshrc に export IXA_API_TOKEN=...）。設定ファイルには書かない。エージェントは DB に直接作らない',
    needsHuman: true,
  },
  docs: 'apps/mcp/README.md',
})

export const writeClaude = async (system: System, target: McpTarget): Promise<StepResult> => {
  const existing = await system.run('claude', ['mcp', 'get', 'ixa'], { timeoutMs: 15_000 })
  if (existing.kind === 'not_found') {
    return { id: 'mcp.claude', status: 'failed', message: 'claude コマンドがありません（Claude Code が入っていない）' }
  }
  if (existing.kind === 'completed' && existing.exitCode === 0) {
    return { id: 'mcp.claude', status: 'already', message: 'Claude Code に ixa はもう登録されています（claude mcp get ixa）' }
  }
  const added = await system.run('claude', claudeAddArgs(target), { timeoutMs: 30_000 })
  return added.kind === 'completed' && added.exitCode === 0
    ? { id: 'mcp.claude', status: 'done', message: 'Claude Code に ixa を登録しました（ユーザーの設定）' }
    : { id: 'mcp.claude', status: 'failed', message: 'claude mcp add に失敗しました', fix: { hint: '上の 1 行を手で打つ', command: claudeAddCommand(target), needsHuman: false } }
}

const writeCodex = async (system: System, target: McpTarget): Promise<StepResult> => {
  const file = path.join(system.homedir, '.codex', 'config.toml')
  const toml = (await system.readText(file)) ?? ''
  if (codexHasIxa(toml)) return { id: 'mcp.codex', status: 'already', message: `${file} に [mcp_servers.ixa] はもうあります（書き換えません）` }
  if (!(await system.exists(path.dirname(file)))) {
    return { id: 'mcp.codex', status: 'failed', message: `${path.dirname(file)} がありません（Codex を一度起動してから）` }
  }
  await system.writeText(file, appendCodexSection(toml, codexTomlSection(target)))
  return { id: 'mcp.codex', status: 'done', message: `${file} に [mcp_servers.ixa] を足しました` }
}

/** 登録の中身（`.env` から）。ワークスペースの ID が空なら null。 */
export const mcpTargetOf = (repo: RepoPaths, env: EnvValues): McpTarget | null =>
  isBlank(env, 'NEXT_PUBLIC_WORKSPACE_ID')
    ? null
    : {
        tsx: repo.mcpTsx,
        main: repo.mcpMain,
        apiUrl: `http://127.0.0.1:${String(portsOf(env).api)}`,
        workspaceId: (env['NEXT_PUBLIC_WORKSPACE_ID'] ?? '').trim(),
      }

export const mcpCommand = async (system: System, repo: RepoPaths, out: Output, options: Options): Promise<number> => {
  const target = mcpTargetOf(repo, await readEnv(system, repo))
  if (target === null) {
    const step: StepResult = {
      id: 'mcp.workspace',
      status: 'failed',
      message: '.env の NEXT_PUBLIC_WORKSPACE_ID が空です',
      fix: { hint: '先に導入を済ませる', command: 'pnpm ixa setup', needsHuman: false },
    }
    out.line(formatStep(step))
    out.result({ command: 'mcp', ok: false, steps: [step] })
    return 1
  }
  const both = !options.claude && !options.codex
  const claude = both || options.claude
  const codex = both || options.codex
  if (claude) out.line(`Claude Code に登録する 1 行:\n  ${claudeAddCommand(target)}\n`)
  if (codex) out.line(`Codex（~/.codex/config.toml に足す節）:\n${codexTomlSection(target)}\n`)
  const written = options.write
    ? [...(claude ? [await writeClaude(system, target)] : []), ...(codex ? [await writeCodex(system, target)] : [])]
    : []
  const steps = [...written, tokenHint()]
  steps.forEach((s) => out.line(formatStep(s)))
  const ok = !written.some((s) => s.status === 'failed')
  out.result({
    command: 'mcp',
    ok,
    ...(claude ? { claude: { command: claudeAddCommand(target) } } : {}),
    ...(codex ? { codex: { file: '~/.codex/config.toml', section: codexTomlSection(target) } } : {}),
    steps,
  })
  return ok ? 0 : 1
}
