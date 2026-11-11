import { AspectRatio, PROJECT_FPS_OPTIONS, PROJECT_RESOLUTIONS } from '@ixa/domain'
import { VideoModelCapabilities } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { localStillMotionModel } from '../local/descriptor.js'

/**
 * 「静止画を動かす」は、無料で Take まで行ける唯一の道。作品の設定で選べる大きさ・fps を 1 つでも
 * 断ると、初めての人が Take で止まる（2026-11-11 の新規 clone の確かめで、HD 縦 720×1280 が断られた）。
 */
describe('静止画を動かすモデルの capability 宣言', () => {
  const { capabilities } = localStillMotionModel

  it('VideoModelCapabilities スキーマを満たす', () => {
    expect(() => VideoModelCapabilities.parse(capabilities)).not.toThrow()
  })

  it('作品で選べる形をすべて受ける', () => {
    expect([...capabilities.aspectRatios].sort()).toEqual([...AspectRatio.options].sort())
  })

  it.each(
    AspectRatio.options.flatMap((aspectRatio) =>
      PROJECT_RESOLUTIONS[aspectRatio].map((resolution) => ({ aspectRatio, ...resolution })),
    ),
  )('作品で選べる大きさ $width×$height（$aspectRatio）を受ける', ({ width, height }) => {
    expect(capabilities.resolutions).toContainEqual({ width, height })
  })

  it('作品で選べる fps をすべて受ける', () => {
    expect([...capabilities.fps].sort()).toEqual([...PROJECT_FPS_OPTIONS].sort())
  })

  it('作品で選べない大きさは受けない（表を写しているだけで、何でも通す口にはしていない）', () => {
    expect(capabilities.resolutions).not.toContainEqual({ width: 640, height: 360 })
  })
})
