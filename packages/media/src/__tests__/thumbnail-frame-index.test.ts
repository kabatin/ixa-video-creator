import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FfmpegError, runFfmpeg } from '../ffmpeg-runner.js'
import { extractFrameByIndex } from '../thumbnail.js'
import { createTempDir, makeTestVideo, removeTempDir } from './fixtures.js'

/**
 * 番号でコマを 1 枚取り出す（「前の Shot から続ける」の元のコマ。2026-10-24）。
 * 秒で狙うと、キーフレーム送りや丸めで隣のコマが出る。番号なら外れない。
 */
const FFMPEG_TIMEOUT_MS = 120_000

describe('extractFrameByIndex', () => {
  let dir: string
  let video: string

  beforeAll(async () => {
    dir = await createTempDir()
    video = await makeTestVideo(join(dir, 'in.mp4'), { width: 160, height: 90, fps: 10, durationSec: 1, withAudio: false })
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(dir)
  })

  it('指した番号のコマを書き出す（全コマを書き出した 8 枚目と同じ絵）', async () => {
    await runFfmpeg(['-y', '-i', video, '-q:v', '3', join(dir, 'all-%02d.jpg')])
    await extractFrameByIndex(video, join(dir, 'f7.jpg'), 7)
    expect(await readFile(join(dir, 'f7.jpg'))).toEqual(await readFile(join(dir, 'all-08.jpg')))
  }, FFMPEG_TIMEOUT_MS)

  it('隣のコマとは違う絵になる', async () => {
    await extractFrameByIndex(video, join(dir, 'f3.jpg'), 3)
    await extractFrameByIndex(video, join(dir, 'f4.jpg'), 4)
    expect(await readFile(join(dir, 'f3.jpg'))).not.toEqual(await readFile(join(dir, 'f4.jpg')))
  }, FFMPEG_TIMEOUT_MS)

  it('無い番号は書き出せずに失敗する', async () => {
    await expect(extractFrameByIndex(video, join(dir, 'f99.jpg'), 99)).rejects.toBeInstanceOf(FfmpegError)
  }, FFMPEG_TIMEOUT_MS)
})
