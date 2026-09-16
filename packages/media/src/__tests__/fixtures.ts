import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFfmpeg } from '../ffmpeg-runner.js'

/**
 * テスト素材は必ず ffmpeg 自身で生成する（testsrc / sine）。
 * バイナリをリポジトリにコミットしないため。
 */
export type FixtureSpec = {
  width: number
  height: number
  fps: number
  durationSec: number
  withAudio: boolean
}

export const createTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'ixa-media-test-'))

export const removeTempDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true })

export const makeTestVideo = async (outputPath: string, spec: FixtureSpec): Promise<string> => {
  const videoInput = [
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=${spec.width}x${spec.height}:rate=${spec.fps}:duration=${spec.durationSec}`,
  ]
  const audioInput = spec.withAudio
    ? ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${spec.durationSec}`]
    : []
  const audioCodec = spec.withAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']

  await runFfmpeg([
    '-y',
    ...videoInput,
    ...audioInput,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    ...audioCodec,
    '-shortest',
    outputPath,
  ])

  return outputPath
}

export const makeTestAudio = async (outputPath: string, durationSec: number): Promise<string> => {
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outputPath,
  ])

  return outputPath
}
