import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClaudeCliEnvelope,
  DEFAULT_CLI_TIMEOUT_MS,
  execFileCliRunner,
  type CliRunResult,
  type CliRunner,
} from './claude-cli-reviewer.js'
import { excerpt } from './errors.js'

/**
 * テキストの AI を CLI で呼ぶ口（ADR-0032 の 2・4 段目）。**CLI ごとの違いはここに閉じる。**
 * Gemini CLI は廃止されたので対応しない（制作者 2026-10-02）。
 *
 * - Claude: `claude -p <prompt> --output-format json`。外枠の `result` と実測の額（`total_cost_usd`）
 * - Codex: `codex exec --skip-git-repo-check --ephemeral --sandbox read-only -o <file> <prompt>`。最後の返事をファイルから読む
 * - Grok: `grok -p <prompt> --output-format plain`。標準出力が返事
 *
 * どれも**使い捨ての作業場所**で呼ぶ（リポジトリの AGENTS.md・CLAUDE.md を読ませない。終わったら片付ける）。
 * 額が測れない CLI は 0（推測値を入れない）。返事の中身（JSON か）は呼び出し側が確かめる。
 */

export type TextCliTool = 'claude' | 'codex' | 'grok'

export type TextCliErrorCode =
  | 'cli_not_found'
  | 'cli_spawn_failed'
  | 'cli_timeout'
  | 'cli_exit_failed'
  | 'cli_not_signed_in'
  | 'response_not_json'
  | 'response_schema_violation'

export type TextCliOutcome =
  | { readonly ok: true; readonly text: string; readonly costUsd: number }
  | {
      readonly ok: false
      readonly code: TextCliErrorCode
      readonly message: string
      readonly costUsd: number
    }

export type TextCli = {
  readonly tool: TextCliTool
  /** 1 回だけ頼み、返事の文をそのまま返す。失敗は投げずに値で返す。 */
  readonly complete: (prompt: string) => Promise<TextCliOutcome>
}

export type TextCliOptions = {
  readonly runner?: CliRunner
  readonly timeoutMs?: number
  /** 使い捨ての作業場所を作る親。既定は OS の一時置き場。 */
  readonly workRoot?: string
}

const LABELS: Readonly<Record<TextCliTool, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  grok: 'Grok',
}

/** CLI がサインインを求めている（Grok の「Not signed in」・Codex の「login」）。 */
const NOT_SIGNED_IN = /not signed in|please log ?in|run `?\w+ login/i

/** 最後の返事を書かせるファイルの名前（Codex）。作業場所の中に置く。 */
const LAST_MESSAGE_FILE = 'last-message.txt'

const argsFor = (tool: TextCliTool, prompt: string, dir: string): readonly string[] => {
  switch (tool) {
    case 'claude':
      return ['-p', prompt, '--output-format', 'json']
    case 'codex':
      return [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '-o',
        join(dir, LAST_MESSAGE_FILE),
        prompt,
      ]
    case 'grok':
      return ['-p', prompt, '--output-format', 'plain']
  }
}

const failed = (code: TextCliErrorCode, message: string, costUsd = 0): TextCliOutcome => ({
  ok: false,
  code,
  message,
  costUsd,
})

/** 返事を取り出す（CLI ごと）。 */
const answerOf = async (
  tool: TextCliTool,
  stdout: string,
  dir: string,
): Promise<TextCliOutcome> => {
  if (tool === 'codex') {
    const text = await readFile(join(dir, LAST_MESSAGE_FILE), 'utf8').catch(() => null)
    return text === null || text.trim() === ''
      ? failed('response_not_json', `${LABELS.codex} の返事が空でした: ${excerpt(stdout)}`)
      : { ok: true, text: text.trim(), costUsd: 0 }
  }
  if (tool !== 'claude') {
    return stdout.trim() === ''
      ? failed('response_not_json', `${LABELS[tool]} の返事が空でした`)
      : { ok: true, text: stdout.trim(), costUsd: 0 }
  }
  const envelope = ((): ReturnType<typeof ClaudeCliEnvelope.safeParse> | null => {
    try {
      return ClaudeCliEnvelope.safeParse(JSON.parse(stdout) as unknown)
    } catch {
      return null
    }
  })()
  if (envelope === null) return failed('response_not_json', `CLI の応答（外枠）が JSON として読めません: ${excerpt(stdout)}`)
  if (!envelope.success) return failed('response_schema_violation', 'CLI の応答（外枠）の形が違います')
  const costUsd = envelope.data.total_cost_usd ?? 0
  if (envelope.data.is_error === true) {
    return failed('cli_exit_failed', `CLI が is_error を返しました: ${excerpt(envelope.data.result)}`, costUsd)
  }
  return { ok: true, text: envelope.data.result, costUsd }
}

const outcomeOf = async (
  tool: TextCliTool,
  run: CliRunResult,
  dir: string,
  timeoutMs: number,
): Promise<TextCliOutcome> => {
  const label = LABELS[tool]
  switch (run.kind) {
    case 'not_found':
      return failed('cli_not_found', `${label}（${tool}）が見つかりません。入っているか確かめてください`)
    case 'timeout':
      return failed('cli_timeout', `${label} が ${String(Math.round(timeoutMs / 1000))} 秒以内に返事をしませんでした`)
    case 'spawn_failed':
      return failed('cli_spawn_failed', `${label} を起動できませんでした: ${run.reason}`)
    case 'completed':
      break
  }
  if (NOT_SIGNED_IN.test(`${run.stdout}\n${run.stderr}`) && (run.exitCode !== 0 || run.stdout.trim() === '')) {
    return failed(
      'cli_not_signed_in',
      `${label} にサインインしていません。ターミナルで \`${tool}\` を一度起動してサインインしてから、もう一度押してください`,
    )
  }
  // exit code を先に見てから出力を解釈する（ADR-0012 の実装上の規約）。
  if (run.exitCode !== 0) {
    return failed('cli_exit_failed', `${label} が異常終了しました（exit=${String(run.exitCode)}）: ${excerpt(run.stderr)}`)
  }
  return answerOf(tool, run.stdout, dir)
}

export const createTextCli = (tool: TextCliTool, options: TextCliOptions = {}): TextCli => {
  const runner = options.runner ?? execFileCliRunner
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
  const workRoot = options.workRoot ?? tmpdir()

  const complete = async (prompt: string): Promise<TextCliOutcome> => {
    const dir = await mkdtemp(join(workRoot, 'ixa-text-cli-'))
    try {
      const run = await runner({ command: tool, args: argsFor(tool, prompt, dir), timeoutMs, cwd: dir }).catch(
        (error: unknown): CliRunResult => ({
          kind: 'spawn_failed',
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
      return await outcomeOf(tool, run, dir, timeoutMs)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  return { tool, complete }
}
