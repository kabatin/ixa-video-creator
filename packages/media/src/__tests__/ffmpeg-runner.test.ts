import { describe, expect, it } from 'vitest'
import {
  FfmpegError,
  resolveFfmpegPath,
  resolveFfprobePath,
  runFfmpeg,
  runFfprobe,
} from '../ffmpeg-runner.js'

const FFMPEG_TIMEOUT_MS = 60_000

describe('resolveFfmpegPath / resolveFfprobePath', () => {
  it('環境変数が未設定ならパス上の実行ファイル名を返す', () => {
    const expectedFfmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg'
    const expectedFfprobe = process.env.FFPROBE_PATH ?? 'ffprobe'

    expect(resolveFfmpegPath()).toBe(expectedFfmpeg)
    expect(resolveFfprobePath()).toBe(expectedFfprobe)
  })
})

describe('runFfmpeg / runFfprobe（実 ffmpeg）', () => {
  it(
    '成功時に stdout を返す',
    async () => {
      const { stdout } = await runFfprobe(['-version'])
      expect(stdout).toContain('ffprobe version')
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '失敗時は stderr 付きの FfmpegError を throw する',
    async () => {
      const error = await runFfmpeg([
        '-i',
        '/nonexistent/definitely-missing.mp4',
        '-f',
        'null',
        '-',
      ])
        .then(() => null)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(FfmpegError)
      const ffmpegError = error as FfmpegError
      expect(ffmpegError.exitCode).not.toBe(0)
      expect(ffmpegError.stderr.length).toBeGreaterThan(0)
      expect(ffmpegError.command).toContain('definitely-missing.mp4')
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    'タイムアウトしたプロセスを落として FfmpegError にする',
    async () => {
      // 60 秒ぶんの再生をリアルタイム速度に制限し、必ずタイムアウトさせる。
      const error = await runFfmpeg(
        ['-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=60', '-f', 'null', '-'],
        { timeoutMs: 300 },
      )
        .then(() => null)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(FfmpegError)
      expect((error as FfmpegError).message).toContain('タイムアウト')
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    'AbortSignal で中断できる',
    async () => {
      const controller = new AbortController()
      const promise = runFfmpeg(
        ['-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=60', '-f', 'null', '-'],
        { signal: controller.signal },
      )
      setTimeout(() => {
        controller.abort()
      }, 200)

      await expect(promise).rejects.toBeInstanceOf(FfmpegError)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it('中断済みの signal では起動前に FfmpegError にする', async () => {
    await expect(runFfmpeg(['-version'], { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
      FfmpegError,
    )
  })

  it(
    'スペースを含むパスをシェル解釈せずにそのまま渡す',
    async () => {
      const error = await runFfprobe(['/tmp/ixa media/does not exist.mp4'])
        .then(() => null)
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(FfmpegError)
      expect((error as FfmpegError).stderr).toContain('does not exist.mp4')
    },
    FFMPEG_TIMEOUT_MS,
  )
})
