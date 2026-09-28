import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeMedia, runFfmpeg } from '@ixa/media'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cropToAspect } from '../crop.js'

/** 実 ffmpeg で確かめる。Codex の横長 1536×1024 を 16:9 に切り抜くと 1536×864 になる。 */

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-image-crop-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const aPng = async (width: number, height: number): Promise<string> => {
  const path = join(dir, `in-${String(width)}x${String(height)}.png`)
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', `color=c=red:s=${String(width)}x${String(height)}`, '-frames:v', '1', path])
  return path
}

describe('cropToAspect', () => {
  it('プロジェクトの比に中央で切り抜いた PNG を作る', async () => {
    const output = join(dir, 'out.png')

    const size = await cropToAspect(await aPng(1536, 1024), output, '16:9')

    expect(size).toEqual({ width: 1536, height: 864 })
    expect(await probeMedia(output)).toMatchObject({ width: 1536, height: 864 })
  })

  it('比が合っていても PNG として書き出す（元の形式に依らない）', async () => {
    const output = join(dir, 'same.png')

    expect(await cropToAspect(await aPng(1920, 1080), output, '16:9')).toEqual({ width: 1920, height: 1080 })
  })
})
