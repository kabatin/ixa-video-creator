import { describe, expect, it } from 'vitest'
import { recommendedFps, WireVideoModel } from '@/lib/models-api'

/**
 * モデルに合わせた fps。
 *
 * 素材が 24fps なのに Project を 30fps にすると、書き出しで 24→30 に引き伸ばされる
 * （`render/ffmpeg-filters.ts` が毎クリップに `fps=doc.fps` を掛ける）。
 * 無い絵を作ることになるので、**素材の側に合わせる**。
 */

const aModel = (fps: readonly number[]): WireVideoModel =>
  WireVideoModel.parse({
    id: 'bytedance/seedance-2.5/reference-to-video',
    providerId: 'fal',
    label: 'Seedance 2.5',
    fps,
    resolutions: [{ width: 1280, height: 720 }],
    aspectRatios: ['16:9'],
    durations: { mode: 'range', min: 4, max: 30 },
    maxReferenceImages: 30,
    costPerSecondUsd: 0.3024,
    audioGeneration: false,
    requiresStartFrame: false,
    routable: true,
  })

describe('recommendedFps', () => {
  it('選べる fps が 1 つならそれ', () => {
    expect(recommendedFps(aModel([24]))).toBe(24)
  })

  /** 引き伸ばしより間引きのほうがまし、ではなく「作らない」を採る。 */
  it('複数あるときは一番小さいものを採る（無い絵を作らない）', () => {
    expect(recommendedFps(aModel([24, 30]))).toBe(24)
    expect(recommendedFps(aModel([60, 30, 24]))).toBe(24)
  })
})

describe('WireVideoModel', () => {
  it('宣言に無い項目は受け取らない（画面が性質を書き足さない）', () => {
    const parsed = WireVideoModel.parse({ ...aModel([24]), 気分: 'よい' })
    expect('気分' in parsed).toBe(false)
  })

  it('fps が空の宣言は読めない扱いにしない（1 つ以上ある前提）', () => {
    // 宣言側（VideoModelCapabilities）が 1 つ以上を要求している。
    // ここで空が来たら recommendedFps は null を返し、画面は fps を触らない。
    expect(recommendedFps(aModel([]))).toBeNull()
  })
})
