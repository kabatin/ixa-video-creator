import { existsSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CliInvocation, CliRunResult, CliRunner } from '../claude-cli-reviewer.js'
import { createTextCli, type TextCliTool } from '../text-cli.js'

/**
 * テキストの AI を CLI で呼ぶ口（ADR-0032 の 2・4 段目）。Claude・Codex・Grok の違い（Gemini CLI は廃止で対応しない）
 * （引数・返事の取り出し方・サインイン前の言い方）をここに閉じる。実 CLI は叩かない。
 */

const recorder = (respond: (call: CliInvocation) => CliRunResult) => {
  const calls: CliInvocation[] = []
  const runner: CliRunner = (call) => {
    calls.push(call)
    return Promise.resolve(respond(call))
  }
  return { calls, runner }
}
const done = (stdout: string, stderr = '', exitCode = 0): CliRunResult => ({ kind: 'completed', exitCode, stdout, stderr })

const complete = (tool: TextCliTool, respond: (call: CliInvocation) => CliRunResult) => {
  const f = recorder(respond)
  return { ...f, cli: createTextCli(tool, { runner: f.runner }) }
}

describe('createTextCli', () => {
  it('Claude: -p と json で呼び、外枠の result と実測の額を返す', async () => {
    const f = complete('claude', () =>
      done(JSON.stringify({ result: '{"text":"夜明け"}', total_cost_usd: 0.02 })),
    )

    const outcome = await f.cli.complete('お願い')

    expect(outcome).toEqual({ ok: true, text: '{"text":"夜明け"}', costUsd: 0.02 })
    expect(f.calls[0]?.command).toBe('claude')
    expect(f.calls[0]?.args).toEqual(['-p', 'お願い', '--output-format', 'json'])
  })

  it('Codex: exec を読み取り専用で呼び、最後の返事をファイルから読む', async () => {
    const f = complete('codex', (call) => {
      const out = call.args[call.args.indexOf('-o') + 1]
      if (out !== undefined) writeFileSync(out, '{"text":"夜明け"}')
      return done('進み具合')
    })

    const outcome = await f.cli.complete('お願い')

    expect(outcome).toEqual({ ok: true, text: '{"text":"夜明け"}', costUsd: 0 })
    const args = f.calls[0]?.args ?? []
    expect(args.slice(0, 5)).toEqual(['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only'])
    expect(args.at(-1)).toBe('お願い')
  })

  it('Grok: 素の文字で返させ、標準出力をそのまま返す', async () => {
    const grok = complete('grok', () => done('{"text":"x"}\n'))

    expect(await grok.cli.complete('p')).toMatchObject({ ok: true, text: '{"text":"x"}' })
    expect(grok.calls[0]?.args).toEqual(['-p', 'p', '--output-format', 'plain'])
  })

  it('サインインしていなければ、そう言う（ターミナルでサインインする）', async () => {
    const grok = complete('grok', () => done('', 'Error: Not signed in. To authenticate without a browser, run:', 1))

    const outcome = await grok.cli.complete('p')
    expect(outcome).toMatchObject({ ok: false, code: 'cli_not_signed_in' })
    expect(outcome.ok ? '' : outcome.message).toContain('サインイン')
  })

  it('リポジトリの外の、使い捨ての作業場所で呼び、終わったら片付ける', async () => {
    const f = complete('grok', () => done('{"text":"g"}'))

    await f.cli.complete('p')

    const cwd = f.calls[0]?.cwd ?? ''
    expect(cwd).not.toBe('')
    expect(cwd).not.toContain(process.cwd())
    expect(existsSync(cwd)).toBe(false)
  })

  it('見つからない・時間切れ・異常終了を分けて言う', async () => {
    const missing = complete('codex', () => ({ kind: 'not_found', reason: 'ENOENT' }))
    const slow = complete('claude', () => ({ kind: 'timeout', timeoutMs: 10 }))
    const broken = complete('grok', () => done('', 'boom', 2))

    expect(await missing.cli.complete('p')).toMatchObject({ ok: false, code: 'cli_not_found' })
    expect(await slow.cli.complete('p')).toMatchObject({ ok: false, code: 'cli_timeout' })
    expect(await broken.cli.complete('p')).toMatchObject({ ok: false, code: 'cli_exit_failed' })
  })
})
