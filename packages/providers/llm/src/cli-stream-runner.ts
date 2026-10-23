import { execFile, spawn } from 'node:child_process'

/**
 * CLI を起こし、**標準出力を 1 行ずつ受け取る**口（ADR-0058。AI エージェントのタブ）。
 *
 * 既存の `CliRunner`（`@ixa/provider-core`）は終わってからまとめて受け取る作りで、流れる返事には向かない。
 * こちらは spawn で起こし、行が届くたびに `onLine` を呼ぶ。止める口（`stop`）を持つ。
 *
 * - **env は渡したものだけ**（親の env を引き継がない。API の DB や外部の鍵を子に持たせない）
 * - 依頼の文は stdin で渡す（引数に入れると `ps` に出るうえ、「--help」のような文が引数に化ける）
 * - 子は自分のプロセスグループで起こし、止めるときはグループごと終わらせる（CLI が起こした MCP も残さない）
 */

export type CliStreamInvocation = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly stdin: string
  readonly env: Readonly<Record<string, string>>
}

export type CliStreamExit =
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: string | null; readonly stderrTail: string }
  | { readonly kind: 'not_found'; readonly reason: string }
  | { readonly kind: 'spawn_failed'; readonly reason: string }

export type CliStreamHandle = {
  /** 子のプロセス番号（＝プロセスグループの番号）。起こせなければ null。作業場所に書いて、API が落ちたあとに片付ける。 */
  readonly pid: number | null
  /** 子が終わったら解決する（失敗も kind で返す。投げない）。 */
  readonly exited: Promise<CliStreamExit>
  /** 止める。SIGTERM を送り、残っていれば少し待って SIGKILL。何度呼んでもよい。 */
  readonly stop: () => void
}

export type CliStreamRunner = (invocation: CliStreamInvocation, onLine: (line: string) => void) => CliStreamHandle

/** stderr は末尾だけ残す（理由を出すため。全部は溜めない）。 */
const STDERR_TAIL_CHARS = 4000
/** SIGTERM のあと SIGKILL までの猶予。 */
const KILL_GRACE_MS = 5000

const nodeErrorCode = (error: Error): string | undefined =>
  'code' in error && typeof error.code === 'string' ? error.code : undefined

/** プロセスグループにシグナルを送る。もう終わっていれば何もしない。 */
export const signalProcessGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal)
  } catch {
    // もう終わっている（ESRCH）。止めることが目的なので、それで足りる。
  }
}

/** プロセスのコマンド行（`ps`）。無ければ null。番号の使い回しで別のプロセスを止めないための確かめに使う。 */
export const processCommandOf = (pid: number): Promise<string | null> =>
  new Promise((resolve) => {
    execFile('ps', ['-o', 'command=', '-p', String(pid)], (error, stdout) => {
      resolve(error === null && stdout.trim() !== '' ? stdout.trim() : null)
    })
  })

export const spawnCliStreamRunner: CliStreamRunner = (invocation, onLine) => {
  const child = spawn(invocation.command, [...invocation.args], {
    cwd: invocation.cwd,
    env: { ...invocation.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  })

  const state = { buffered: '', stderr: '', finished: false }

  const signalGroup = (signal: NodeJS.Signals): void => {
    if (child.pid !== undefined) signalProcessGroup(child.pid, signal)
  }

  const exited = new Promise<CliStreamExit>((resolve) => {
    child.on('error', (error) => {
      if (state.finished) return
      state.finished = true
      resolve(
        nodeErrorCode(error) === 'ENOENT'
          ? { kind: 'not_found', reason: error.message }
          : { kind: 'spawn_failed', reason: error.message },
      )
    })
    child.on('close', (exitCode, signal) => {
      if (state.finished) return
      state.finished = true
      if (state.buffered !== '') onLine(state.buffered)
      state.buffered = ''
      // 子が終わっても、子が起こした MCP が残ることがある。グループごと止める。
      signalGroup('SIGTERM')
      resolve({ kind: 'exited', exitCode, signal, stderrTail: state.stderr })
    })
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    const parts = `${state.buffered}${chunk}`.split('\n')
    state.buffered = parts.pop() ?? ''
    parts.forEach((line) => onLine(line))
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    state.stderr = `${state.stderr}${chunk}`.slice(-STDERR_TAIL_CHARS)
  })
  // 起動に失敗したときは stdin も書けない。結果は上の 'error' が返す。
  child.stdin.on('error', () => undefined)
  child.stdin.end(invocation.stdin)

  return {
    pid: child.pid ?? null,
    exited,
    stop: () => {
      if (state.finished) return
      signalGroup('SIGTERM')
      const timer = setTimeout(() => {
        if (!state.finished) signalGroup('SIGKILL')
      }, KILL_GRACE_MS)
      timer.unref()
    },
  }
}
