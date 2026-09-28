import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'

/**
 * CLI を Provider として呼ぶ口（ADR-0012）。Claude Code CLI（絵コンテの下書き・判定）と
 * Codex CLI（絵コンテの画像、ADR-0029）が同じ口を使う。
 *
 * **実 CLI を CI で叩かないため**に、呼び出し側へは `CliRunner` を注入できるようにする
 * （ADR-0004 の契約テスト方針）。
 */

/** ハングした CLI がキューを詰まらせるため必ず設定する。既定 10 分（ADR-0012）。 */
export const DEFAULT_CLI_TIMEOUT_MS = 10 * 60 * 1000

/** stdout を無制限に溜めない。巨大な出力は CLI 側の異常なので切り上げてよい。 */
const MAX_STDOUT_BYTES = 10 * 1024 * 1024

export type CliInvocation = {
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
  /** 作業ディレクトリ。生成ごとに隔離するときに使う。省略すると呼び出し元のまま。 */
  readonly cwd?: string
  /**
   * stdin に渡す文。**渡さなくても stdin は必ず閉じる。** Codex CLI は stdin が開いていると
   * 入力の終わりを待ち続ける（ADR-0029 の実測）。
   */
  readonly stdin?: string
}

/**
 * 実行結果。**想定内の失敗は throw せず kind で返す。**
 * こうしておくとテスト側のモックが Node のエラー形（`ENOENT` など）を真似ずに済む。
 */
export type CliRunResult =
  | { readonly kind: 'completed'; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | { readonly kind: 'not_found'; readonly reason: string }
  | { readonly kind: 'spawn_failed'; readonly reason: string }

export type CliRunner = (invocation: CliInvocation) => Promise<CliRunResult>

const sha256Short = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 12)

/**
 * プロンプト本文を伏せたコマンド文字列。
 * プロンプトには都度発行した署名付き URL が入りうるため、**そのままログへ出さない**
 * （CLAUDE.md 規約 7）。同一性の追跡はダイジェストで足りる。
 */
export const redactCommand = (
  binary: string,
  args: readonly string[],
  prompt: string,
): string =>
  [
    binary,
    ...args.map((arg) =>
      arg === prompt ? `<prompt:${prompt.length}chars sha256=${sha256Short(prompt)}>` : arg,
    ),
  ].join(' ')

/** 既定のサブプロセス実行。想定内の失敗は kind へ落とし、例外は投げない。 */
export const execFileCliRunner: CliRunner = (invocation) =>
  new Promise<CliRunResult>((resolve) => {
    const child = execFile(
      invocation.command,
      [...invocation.args],
      {
        timeout: invocation.timeoutMs,
        maxBuffer: MAX_STDOUT_BYTES,
        killSignal: 'SIGKILL',
        ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ kind: 'completed', exitCode: 0, stdout, stderr })
          return
        }
        if (error.code === 'ENOENT') {
          resolve({ kind: 'not_found', reason: error.message })
          return
        }
        // execFile は timeout で killSignal を送る。exit code より先に判定する。
        if (error.code === 'ETIMEDOUT' || error.killed === true) {
          resolve({ kind: 'timeout', timeoutMs: invocation.timeoutMs })
          return
        }
        if (typeof error.code === 'number') {
          resolve({ kind: 'completed', exitCode: error.code, stdout, stderr })
          return
        }
        resolve({ kind: 'spawn_failed', reason: error.message })
      },
    )
    // 起動に失敗したときは stdin も無い。書けなくても結果は上の callback が返す。
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(invocation.stdin ?? '')
  })
