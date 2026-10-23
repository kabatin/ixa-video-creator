import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { agentCliEnv, buildAgentCliArgs, buildAgentMcpConfig } from '../claude-agent-cli.js'
import { spawnCliStreamRunner, type CliStreamExit } from '../cli-stream-runner.js'

/**
 * AI エージェントのタブ（ADR-0058）の Claude CLI の起こし方。引数は CLI 2.1.289 で実際に流して確かめた形。
 * - `--allowedTools` は付けない（付けたツールは `--permission-prompt-tool` を通らずに走った）
 * - `--setting-sources ""` と `--permission-mode manual`（制作者の ~/.claude の auto モードとフックを効かせない）
 * - `--tools ""`（組み込みのツールを外し、ixa の MCP だけにする）
 */

describe('buildAgentCliArgs', () => {
  it('最初のやりとり: stream-json で流し、ixa の MCP だけを使い、確認は approve に聞く', () => {
    expect(buildAgentCliArgs({ model: 'claude-sonnet-5-5', mcpConfigPath: '/s/mcp.json', resumeCliSessionId: null })).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'claude-sonnet-5-5',
      '--mcp-config',
      '/s/mcp.json',
      '--strict-mcp-config',
      '--tools',
      '',
      '--setting-sources',
      '',
      '--permission-mode',
      'manual',
      '--disable-slash-commands',
      '--permission-prompt-tool',
      'mcp__ixa__approve',
    ])
  })

  it('2 回目から: --resume で続きから話す', () => {
    const args = buildAgentCliArgs({ model: 'claude-sonnet-5-5', mcpConfigPath: '/s/mcp.json', resumeCliSessionId: 'abc-123' })
    expect(args.slice(-2)).toEqual(['--resume', 'abc-123'])
  })

  it('依頼の文は引数に入れない（stdin で渡す。「--help」のような文が引数に化けない）', () => {
    const args = buildAgentCliArgs({ model: 'claude-sonnet-5-5', mcpConfigPath: '/s/mcp.json', resumeCliSessionId: null })
    expect(args).not.toContain('--allowedTools')
    expect(args[1]).toBe('--output-format')
  })

  it('確認を飛ばす引数を付けない（--allowedTools・--dangerously-skip-permissions・bypass 系）。権限の型は manual だけ', () => {
    // 付けたツールは --permission-prompt-tool を通らずに走る（CLI 2.1.289 の実測）。CLI の版が上がっても外れないよう固定する。
    for (const resume of [null, 'abc-123']) {
      const args = buildAgentCliArgs({ model: 'claude-sonnet-5-5', mcpConfigPath: '/s/mcp.json', resumeCliSessionId: resume })
      const joined = args.join(' ')
      expect(joined).not.toMatch(/allowed-?tools/i)
      expect(joined).not.toMatch(/dangerously/i)
      expect(joined).not.toMatch(/bypass/i)
      expect(joined).not.toMatch(/--permission-prompts\b/)
      expect(args.filter((arg) => arg === '--permission-mode')).toHaveLength(1)
      expect(args[args.indexOf('--permission-mode') + 1]).toBe('manual')
      expect(args[args.indexOf('--permission-prompt-tool') + 1]).toBe('mcp__ixa__approve')
      expect(args[args.indexOf('--tools') + 1]).toBe('')
      expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    }
  })

  it('モデル ID でない値・引数に化ける会話 ID は受けない', () => {
    expect(() => buildAgentCliArgs({ model: 'sonnet', mcpConfigPath: '/s', resumeCliSessionId: null })).toThrow()
    expect(() => buildAgentCliArgs({ model: '--x', mcpConfigPath: '/s', resumeCliSessionId: null })).toThrow()
    expect(() =>
      buildAgentCliArgs({ model: 'claude-sonnet-5-5', mcpConfigPath: '/s', resumeCliSessionId: '--dangerously-skip-permissions' }),
    ).toThrow()
  })
})

describe('buildAgentMcpConfig', () => {
  it('ixa の MCP を 1 つだけ、渡された env で起こす', () => {
    expect(
      buildAgentMcpConfig({ command: '/bin/tsx', args: ['/m/main.ts'], env: { IXA_API_TOKEN: 't', IXA_AGENT_SESSION_ID: 's' } }),
    ).toEqual({
      mcpServers: { ixa: { command: '/bin/tsx', args: ['/m/main.ts'], env: { IXA_API_TOKEN: 't', IXA_AGENT_SESSION_ID: 's' } } },
    })
  })
})

describe('agentCliEnv', () => {
  it('CLI に渡す env は、動くのに要るものだけ（DB や外部の鍵を渡さない）', () => {
    const env = agentCliEnv({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      USER: 'me',
      LANG: 'ja_JP.UTF-8',
      TMPDIR: '/tmp/',
      DATABASE_URL: 'postgres://secret',
      FAL_API_KEY: 'secret',
      IXA_PASSPHRASE: 'secret',
      ANTHROPIC_API_KEY: undefined,
    })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', USER: 'me', LANG: 'ja_JP.UTF-8', TMPDIR: '/tmp/' })
  })
})

describe('spawnCliStreamRunner（本物の子プロセス。CLI の代わりに node のスクリプトを起こす）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ixa-cli-stream-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const script = (name: string, body: string): string => {
    const path = join(dir, name)
    writeFileSync(path, body)
    return path
  }
  const run = (path: string, stdin = '', extra: { readonly env?: Record<string, string> } = {}) => {
    const lines: string[] = []
    const handle = spawnCliStreamRunner(
      { command: process.execPath, args: [path], cwd: dir, stdin, env: { PATH: process.env['PATH'] ?? '', ...extra.env } },
      (line) => lines.push(line),
    )
    return { lines, handle }
  }

  it('行ごとに順に受け取る（途中で切れて届いた行も 1 行にする）。stdin で依頼を渡す', async () => {
    const path = script(
      'echo.mjs',
      `let input = ''
process.stdin.on('data', (d) => { input += d })
process.stdin.on('end', () => {
  process.stdout.write('{"a":1}\\n{"b":')
  setTimeout(() => { process.stdout.write('2}\\n' + JSON.stringify({ input }) + '\\nlast-without-newline') }, 20)
})`,
    )
    const { lines, handle } = run(path, 'こんにちは --help')
    const exit = await handle.exited
    expect(exit).toMatchObject({ kind: 'exited', exitCode: 0 })
    expect(lines).toEqual(['{"a":1}', '{"b":2}', JSON.stringify({ input: 'こんにちは --help' }), 'last-without-newline'])
  })

  it('env は渡したものだけ（親の env を引き継がない）', async () => {
    const path = script('env.mjs', `process.stdout.write(JSON.stringify(Object.keys(process.env).filter((k) => k === 'SECRET_X' || k === 'GIVEN')) + '\\n')`)
    process.env['SECRET_X'] = 'leak'
    const { lines, handle } = run(path, '', { env: { GIVEN: '1' } })
    await handle.exited
    delete process.env['SECRET_X']
    expect(lines).toEqual([JSON.stringify(['GIVEN'])])
  })

  it('失敗の終わり方は exitCode と stderr の末尾で返す', async () => {
    const path = script('fail.mjs', `process.stderr.write('うまくいきません'); process.exit(3)`)
    const exit: CliStreamExit = await run(path).handle.exited
    expect(exit).toMatchObject({ kind: 'exited', exitCode: 3 })
    if (exit.kind === 'exited') expect(exit.stderrTail).toContain('うまくいきません')
  })

  it('止めると、子（とその子）を終わらせる', async () => {
    const path = script(
      'hang.mjs',
      `process.stdout.write('started\\n'); setInterval(() => {}, 1000); process.on('SIGTERM', () => process.exit(143))`,
    )
    const { lines, handle } = run(path)
    await new Promise((resolve) => setTimeout(resolve, 300))
    handle.stop()
    const exit = await handle.exited
    expect(lines).toEqual(['started'])
    expect(exit.kind).toBe('exited')
  })

  it('子が終わったら、残った孫（CLI が起こした MCP）もグループごと止める', async () => {
    const path = script(
      'grandchild.mjs',
      `import { spawn } from 'node:child_process'
const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
process.stdout.write(String(g.pid) + '\\n')
setTimeout(() => process.exit(0), 100)`,
    )
    const { lines, handle } = run(path)
    expect(handle.pid).toEqual(expect.any(Number))
    await handle.exited
    const grandchild = Number(lines[0])
    await new Promise((resolve) => setTimeout(resolve, 200))
    const alive = (() => {
      try {
        process.kill(grandchild, 0)
        return true
      } catch {
        return false
      }
    })()
    expect(alive).toBe(false)
  })

  it('コマンドが無ければ not_found', async () => {
    const handle = spawnCliStreamRunner(
      { command: join(dir, 'no-such-cli'), args: [], cwd: dir, stdin: '', env: {} },
      () => undefined,
    )
    expect((await handle.exited).kind).toBe('not_found')
  })
})
