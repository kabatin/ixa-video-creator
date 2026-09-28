import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileCliRunner, redactCommand } from '../cli-runner.js'

/**
 * CLI を呼ぶ口（ADR-0012 / ADR-0029）。**本物の小さなプロセスで確かめる**（Node を CLI 代わりに使う）。
 *
 * Codex CLI は指示を stdin で受ける（`-i` が複数の値を取り、後ろに置いた指示を画像として食うため）。
 * **stdin を閉じないと、CLI は入力の終わりを待ち続ける**（実測で `Reading additional input from stdin...`）。
 */

const NODE = process.execPath
const run = (script: string, extra: { cwd?: string; stdin?: string; timeoutMs?: number } = {}) =>
  execFileCliRunner({ command: NODE, args: ['-e', script], timeoutMs: extra.timeoutMs ?? 10_000, ...extra })

let dir: string | null = null
afterEach(async () => {
  if (dir !== null) await rm(dir, { recursive: true, force: true })
  dir = null
})

describe('execFileCliRunner', () => {
  it('終わったら終了コードと出力を返す', async () => {
    expect(await run("process.stdout.write('ok')")).toEqual({ kind: 'completed', exitCode: 0, stdout: 'ok', stderr: '' })
  })

  it('0 以外で終わっても例外にせず、終了コードを返す', async () => {
    const result = await run("process.stderr.write('bad'); process.exit(3)")
    expect(result).toMatchObject({ kind: 'completed', exitCode: 3, stderr: 'bad' })
  })

  it('コマンドが無ければ not_found', async () => {
    const result = await execFileCliRunner({ command: 'ixa-no-such-cli', args: [], timeoutMs: 5_000 })
    expect(result.kind).toBe('not_found')
  })

  it('時間を過ぎたら止めて timeout', async () => {
    const result = await run('setTimeout(() => {}, 60_000)', { timeoutMs: 300 })
    expect(result).toEqual({ kind: 'timeout', timeoutMs: 300 })
  })

  it('作業ディレクトリを指定できる', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ixa-cli-runner-'))
    const result = await run('process.stdout.write(process.cwd())', { cwd: dir })
    expect(result.kind === 'completed' ? await realpath(result.stdout) : null).toBe(await realpath(dir))
  })

  it('stdin に文を渡せる', async () => {
    const result = await run('process.stdin.pipe(process.stdout)', { stdin: '画像を 1 枚' })
    expect(result).toMatchObject({ kind: 'completed', stdout: '画像を 1 枚' })
  })

  it('stdin を渡さなくても閉じる（入力の終わりを待ち続けない）', async () => {
    const result = await run("process.stdin.on('end', () => process.stdout.write('eof')); process.stdin.resume()", {
      timeoutMs: 3_000,
    })
    expect(result).toMatchObject({ kind: 'completed', stdout: 'eof' })
  })
})

describe('redactCommand', () => {
  it('指示の引数だけを伏せる（署名付き URL を記録に残さない）', () => {
    const redacted = redactCommand('claude', ['-p', 'secret?sig=abc', '--output-format', 'json'], 'secret?sig=abc')

    expect(redacted).not.toContain('sig=abc')
    expect(redacted).toContain('--output-format json')
  })
})
