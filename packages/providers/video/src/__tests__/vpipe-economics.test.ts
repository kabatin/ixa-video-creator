import { ModelEconomics, estimateLatencySec } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { vpipeH3TurboDraftModel, vpipeVideoModels } from '../vpipe/descriptor.js'

/**
 * vpipe の生成時間の目安（制作者 2026-10-02「5秒ぐらいの動画で7分だからそれから計算する必要がありそう」）。
 * 宣言した値がスキーマを通ること（記述子はどこでも parse されないので、ここで通す）と、実測に近いこと。
 */

describe('vpipe の生成時間の目安', () => {
  it.each(vpipeVideoModels.map((model) => [model.id, model] as const))('%s の宣言はスキーマを通る', (_id, model) => {
    expect(ModelEconomics.parse(model.economics)).toEqual(model.economics)
    expect(model.economics.latencySecPerOutputSec).toBeGreaterThan(0)
  })

  it.each([
    [5.167, 420],
    [6.583, 549],
    [10.125, 911],
    [10.125, 949],
  ])('下書き: %s 秒の実測 %s 秒から 15%% 以内', (outputSec, measuredSec) => {
    const estimate = estimateLatencySec(vpipeH3TurboDraftModel.economics, outputSec)

    expect(Math.abs(estimate - measuredSec) / measuredSec).toBeLessThan(0.15)
  })
})
