import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MediaAssetId, type ShotGenerationSpec } from '@ixa/domain'
import { probeMedia, runFfmpeg } from '@ixa/media'
import { CapabilityViolationError, type VideoGenerationRequest } from '@ixa/provider-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOCAL_PROVIDER_ID, localStillMotionModel } from '../local/descriptor.js'
import { createLocalImageToVideoProvider } from '../local/provider.js'
import { createTempDir, makeSpec, pollUntilSettled, removeTempDir } from './fixtures.js'

/**
 * ローカルの画像→動画（ADR-0025）。**実 ffmpeg で確かめる。**
 * 最初のフレームの画像を、Shot の尺・解像度・fps の動画にする。費用は 0。
 */

const START_FRAME = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')
const TEST_TIMEOUT_MS = 180_000

const withStartFrame = (overrides: Partial<ShotGenerationSpec> = {}): ShotGenerationSpec =>
  makeSpec({ references: [{ mediaAssetId: START_FRAME, role: 'start_frame', weight: 1 }], ...overrides })

describe('createLocalImageToVideoProvider', () => {
  let dir = ''
  let image = ''
  const resolved: string[] = []

  const request = (spec: ShotGenerationSpec): VideoGenerationRequest => ({
    model: localStillMotionModel,
    spec,
    resolveReference: (id) => {
      resolved.push(id)
      return Promise.resolve(image)
    },
  })

  beforeAll(async () => {
    dir = await createTempDir()
    image = join(dir, 'frame.png')
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080', '-frames:v', '1', image])
  })

  afterAll(async () => {
    await removeTempDir(dir)
  })

  it('AUTO の候補にせず、最初のフレームを要し、無料', () => {
    expect(localStillMotionModel.routable).toBe(false)
    expect(localStillMotionModel.capabilities.requiresStartFrame).toBe(true)
    expect(localStillMotionModel.economics.costPerSecondUsd).toBe(0)
    expect(localStillMotionModel.providerId).toBe(LOCAL_PROVIDER_ID)
  })

  it(
    '最初のフレームを取りに行き、尺・解像度の合った動画を返す',
    async () => {
      const provider = createLocalImageToVideoProvider({ outputDir: join(dir, 'out') })
      const handle = await provider.submit(request(withStartFrame({ durationSec: 3 })))
      const status = await pollUntilSettled(provider, handle)

      expect(status.state).toBe('succeeded')
      if (status.state !== 'succeeded' || status.output.type !== 'local') return
      expect(resolved).toContain(START_FRAME)
      expect(status.costUsd).toBe(0)
      const probe = await probeMedia(status.output.path)
      expect(probe.durationSec).toBeCloseTo(3, 1)
      expect(probe.width).toBe(1280)
      expect(probe.height).toBe(720)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '同じ画像から作り直しても、毎回違う動画になる（重複判定で古い Take に化けない）',
    async () => {
      const provider = createLocalImageToVideoProvider({ outputDir: join(dir, 'twice') })
      const sums = []
      for (let i = 0; i < 2; i += 1) {
        const status = await pollUntilSettled(provider, await provider.submit(request(withStartFrame({ durationSec: 1 }))))
        if (status.state !== 'succeeded' || status.output.type !== 'local') throw new Error('失敗した')
        sums.push(createHash('sha256').update(await readFile(status.output.path)).digest('hex'))
      }
      expect(sums[0]).not.toBe(sums[1])
    },
    TEST_TIMEOUT_MS,
  )

  /**
   * **確率に頼らない。** 動きの組み合わせは有限なので、別々のジョブがたまたま同じ動きを
   * 引くことがある（CI で 1 度そうなって落ちた）。同じ seed を明示して必ず同じ動きにしても、
   * ジョブが違えば別のファイルになる（checksum の重複判定で 1 本にまとめられない）。
   */
  it(
    '同じ seed・同じ動きでも、ジョブが違えば別のファイルになる',
    async () => {
      const provider = createLocalImageToVideoProvider({ outputDir: join(dir, 'same-seed') })
      const sums = []
      for (let i = 0; i < 2; i += 1) {
        const status = await pollUntilSettled(
          provider,
          await provider.submit(request(withStartFrame({ durationSec: 1, seed: 42 }))),
        )
        if (status.state !== 'succeeded' || status.output.type !== 'local') throw new Error('失敗した')
        sums.push(createHash('sha256').update(await readFile(status.output.path)).digest('hex'))
      }
      expect(sums[0]).not.toBe(sums[1])
    },
    TEST_TIMEOUT_MS,
  )

  it('最初のフレームが無ければ投入しない', async () => {
    const provider = createLocalImageToVideoProvider({ outputDir: join(dir, 'none') })

    await expect(provider.submit(request(makeSpec()))).rejects.toBeInstanceOf(CapabilityViolationError)
  })

  it(
    '画像を読めなければ失敗として返す（落ちない）',
    async () => {
      const provider = createLocalImageToVideoProvider({ outputDir: join(dir, 'broken') })
      const broken: VideoGenerationRequest = {
        model: localStillMotionModel,
        spec: withStartFrame({ durationSec: 1 }),
        resolveReference: () => Promise.resolve(join(dir, 'missing.png')),
      }

      const status = await pollUntilSettled(provider, await provider.submit(broken))

      expect(status.state).toBe('failed')
    },
    TEST_TIMEOUT_MS,
  )
})
