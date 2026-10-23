import { readFileSync } from 'node:fs'
import type { CliStreamExit, CliStreamInvocation, CliStreamRunner } from '@ixa/provider-llm'

/**
 * 偽の Claude CLI（ADR-0058 の api のテスト）。起こされたら `script` を走らせ、決まった stream-json の行を返す。
 * 本物の CLI は叩かない。MCP の approve の代わりに、テストが `call.mcpToken()` の鍵で確認の口を呼べる。
 */

export type FakeCliCall = {
  readonly invocation: CliStreamInvocation
  readonly emit: (line: unknown) => void
  /** MCP の設定ファイルに書かれた鍵（approve が使うもの）。 */
  readonly mcpToken: () => string
  readonly mcpEnv: () => Readonly<Record<string, string>>
  readonly stopped: () => boolean
  /** 止められるまで待つ。 */
  readonly untilStopped: () => Promise<void>
}

export type FakeCli = {
  readonly runner: CliStreamRunner
  readonly calls: FakeCliCall[]
}

const readMcpEnv = (invocation: CliStreamInvocation): Readonly<Record<string, string>> => {
  const path = invocation.args[invocation.args.indexOf('--mcp-config') + 1] ?? ''
  const config = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: { ixa: { env: Record<string, string> } } }
  return config.mcpServers.ixa.env
}

export const createFakeCli = (script: (call: FakeCliCall) => Promise<CliStreamExit>): FakeCli => {
  const calls: FakeCliCall[] = []
  const runner: CliStreamRunner = (invocation, onLine) => {
    const state = { stopped: false, wake: (): void => undefined }
    const call: FakeCliCall = {
      invocation,
      emit: (line) => onLine(typeof line === 'string' ? line : JSON.stringify(line)),
      mcpToken: () => readMcpEnv(invocation)['IXA_API_TOKEN'] ?? '',
      mcpEnv: () => readMcpEnv(invocation),
      stopped: () => state.stopped,
      untilStopped: () =>
        state.stopped
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              state.wake = resolve
            }),
    }
    calls.push(call)
    return {
      pid: 4242,
      exited: Promise.resolve().then(() => script(call)),
      stop: () => {
        state.stopped = true
        state.wake()
      },
    }
  }
  return { runner, calls }
}

export const exited = (exitCode = 0): CliStreamExit => ({ kind: 'exited', exitCode, signal: null, stderrTail: '' })

/** CLI 2.1.289 の行の形（domain の fixture と同じ形の最小限）。 */
export const cliLines = {
  init: (sessionId: string) => ({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5-5' }),
  text: (sessionId: string, text: string) => ({
    type: 'assistant',
    session_id: sessionId,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }),
  toolUse: (sessionId: string, id: string, name: string, input: unknown) => ({
    type: 'assistant',
    session_id: sessionId,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  }),
  toolResult: (sessionId: string, id: string, text: string, isError = false) => ({
    type: 'user',
    session_id: sessionId,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] },
  }),
  result: (sessionId: string, costUsd: number, isError = false) => ({
    type: 'result',
    subtype: 'success',
    is_error: isError,
    result: 'done',
    session_id: sessionId,
    total_cost_usd: costUsd,
    duration_ms: 1500,
  }),
}
