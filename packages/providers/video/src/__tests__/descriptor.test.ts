import { AspectRatio, PROJECT_FPS_OPTIONS, PROJECT_RESOLUTIONS, quantizeDuration } from '@ixa/domain'
import { VideoModelCapabilities } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import {
  stubSeedanceLikeModel,
  stubVeoLikeModel,
  stubVideoModels,
} from '../stub/descriptor.js'

describe('スタブモデルの capability 宣言', () => {
  it('VideoModelCapabilities スキーマを満たす', () => {
    for (const model of stubVideoModels) {
      expect(() => VideoModelCapabilities.parse(model.capabilities)).not.toThrow()
    }
  })

  it('作品で選べる形・大きさ・fps はすべて受ける（お試しは初めての人が選ぶ。模すのは尺と参照の制約）', () => {
    for (const model of stubVideoModels) {
      expect([...model.capabilities.aspectRatios].sort()).toEqual([...AspectRatio.options].sort())
      expect([...model.capabilities.fps].sort()).toEqual([...PROJECT_FPS_OPTIONS].sort())
      for (const aspectRatio of AspectRatio.options) {
        for (const resolution of PROJECT_RESOLUTIONS[aspectRatio]) {
          expect(model.capabilities.resolutions).toContainEqual(resolution)
        }
      }
    }
  })

  it('コストは 0（ADR-0014: スタブは課金しない）', () => {
    for (const model of stubVideoModels) expect(model.economics.costPerSecondUsd).toBe(0)
  })

  it('veo-like は 4 / 6 / 8 秒の離散値しか出せない', () => {
    const { durations } = stubVeoLikeModel.capabilities
    expect(durations).toEqual({ mode: 'enum', values: [4, 6, 8] })
    expect(quantizeDuration(3.75, durations)).toBe(4)
    expect(quantizeDuration(5, durations)).toBe(6)
  })

  it('seedance-like は 4〜15 秒の連続値', () => {
    const { durations } = stubSeedanceLikeModel.capabilities
    expect(quantizeDuration(3.75, durations)).toBe(4)
    expect(quantizeDuration(7.5, durations)).toBe(7.5)
  })

  it('参照枚数の上限が実モデルを模している', () => {
    expect(stubVeoLikeModel.capabilities.referenceImages.max).toBe(3)
    expect(stubSeedanceLikeModel.capabilities.referenceImages.max).toBe(9)
  })

  it('音声生成には対応しない', () => {
    for (const model of stubVideoModels) expect(model.capabilities.audioGeneration).toBe(false)
  })
})
