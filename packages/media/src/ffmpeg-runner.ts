import { spawn } from 'node:child_process'

export type RunResult = { stdout: string; stderr: string }

export type RunOptions = {
  /** 既定は DEFAULT_TIMEOUT_MS。超過したプロセスは SIGKILL で落とす。 */
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * ハングした ffmpeg が media キューを詰まらせるのを防ぐための既定タイムアウト（5 分）。
 * 長尺素材を扱う呼び出し側は RunOptions.timeoutMs で明示的に延長すること。
 */
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** stderr を無制限にバッファすると 4K 素材のエンコードでメモリを食うため、末尾のみ保持する。 */
const MAX_STDERR_BYTES = 1024 * 1024

/**
 * FFmpeg / FFprobe の実行に失敗したときに throw される。
 * 原因調査に stderr が必須なので、必ず保持して握り潰さない（CLAUDE.md 規約 5）。
 */
export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    options?: { cause?: unknown },
  ) {
    super(`${message} [${command}] exitCode=${exitCode ?? 'null'}\n${stderr}`, options)
    this.name = 'FfmpegError'
  }
}

/** 実行ファイルのパスは環境変数で上書きできる。未設定ならパス上の ffmpeg / ffprobe を使う。 */
export const resolveFfmpegPath = (): string => process.env.FFMPEG_PATH ?? 'ffmpeg'
export const resolveFfprobePath = (): string => process.env.FFPROBE_PATH ?? 'ffprobe'

/** ログ・エラーメッセージ用の表示文字列。これをシェルに渡して実行してはいけない。 */
const formatCommand = (executable: string, args: readonly string[]): string =>
  [executable, ...args].join(' ')

const appendCapped = (buffer: string, chunk: string): string => {
  const next = buffer + chunk
  return next.length > MAX_STDERR_BYTES ? next.slice(next.length - MAX_STDERR_BYTES) : next
}

/**
 * 子プロセスとして実行する共通基盤。
 * シェルを経由しない（`shell: false`）ため、ファイル名にスペースや引用符が含まれていても安全。
 */
const run = (
  executable: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const command = formatCommand(executable, args)
  const signal = options.signal

  if (signal?.aborted === true) {
    return Promise.reject(
      new FfmpegError('実行前に中断されました', command, null, '', { cause: signal.reason }),
    )
  }

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false

    const onAbort = (): void => {
      aborted = true
      child.kill('SIGKILL')
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout = appendCapped(stdout, chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = appendCapped(stderr, chunk)
    })

    child.on('error', (error: Error) => {
      settle(() => {
        reject(
          new FfmpegError('プロセスを起動できませんでした', command, null, stderr, {
            cause: error,
          }),
        )
      })
    })

    child.on('close', (code: number | null, signalName: NodeJS.Signals | null) => {
      settle(() => {
        if (timedOut) {
          reject(new FfmpegError(`${timeoutMs}ms でタイムアウトしました`, command, code, stderr))
          return
        }
        if (aborted) {
          reject(
            new FfmpegError('中断されました', command, code, stderr, { cause: signal?.reason }),
          )
          return
        }
        if (code !== 0) {
          const reason =
            signalName === null ? '異常終了しました' : `シグナル ${signalName} で終了しました`
          reject(new FfmpegError(reason, command, code, stderr))
          return
        }
        resolve({ stdout, stderr })
      })
    })
  })
}

export const runFfprobe = (args: readonly string[], options?: RunOptions): Promise<RunResult> =>
  run(resolveFfprobePath(), args, options)

export const runFfmpeg = (args: readonly string[], options?: RunOptions): Promise<RunResult> =>
  run(resolveFfmpegPath(), args, options)
