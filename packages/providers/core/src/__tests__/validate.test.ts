import { describe, expect, it } from 'vitest'
import { MediaAssetId } from '@ixa/domain'
import { canHandle, validateAgainstCapabilities } from '../validate.js'
import { makeModel, makeSpec } from './fixtures.js'

const asset = () => MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

describe('validateAgainstCapabilities', () => {
  it('満たせる要求では違反ゼロ', () => {
    expect(validateAgainstCapabilities(makeSpec(), makeModel({ id: 'a' }))).toEqual([])
    expect(canHandle(makeSpec(), makeModel({ id: 'a' }))).toBe(true)
  })

  it('離散的な尺しか出せないモデルで中途半端な尺を弾く', () => {
    const veo = makeModel({
      id: 'veo',
      capabilities: { durations: { mode: 'enum', values: [4, 6, 8] } } as never,
    })
    expect(validateAgainstCapabilities(makeSpec({ durationSec: 4 }), veo)).toEqual([])
    // 切り上げれば出せるので違反にしない
    expect(validateAgainstCapabilities(makeSpec({ durationSec: 3.75 }), veo)).toEqual([])
    // 最長を超えても、最長で作ってゆっくり再生すれば埋まる（0.5 倍速まで。ADR-0011 追記）
    expect(validateAgainstCapabilities(makeSpec({ durationSec: 9 }), veo)).toEqual([])
    // 最長の 2 倍を超えるものは弾く
    expect(validateAgainstCapabilities(makeSpec({ durationSec: 16.01 }), veo)).toHaveLength(1)
  })

  it('参照画像の枚数超過を弾く', () => {
    const veo = makeModel({
      id: 'veo',
      capabilities: { referenceImages: { max: 3, roles: ['subject'] } } as never,
    })
    const spec = makeSpec({
      references: Array.from({ length: 4 }, () => ({
        mediaAssetId: asset(), role: 'subject' as const, weight: 1,
      })),
    })
    const violations = validateAgainstCapabilities(spec, veo)
    expect(violations.some((v) => v.includes('4 枚') && v.includes('3 枚'))).toBe(true)
  })

  it('未対応の参照ロールを弾く', () => {
    const model = makeModel({
      id: 'm',
      capabilities: { referenceImages: { max: 9, roles: ['subject'] } } as never,
    })
    const spec = makeSpec({
      references: [{ mediaAssetId: asset(), role: 'end_frame', weight: 1 }],
    })
    expect(validateAgainstCapabilities(spec, model).some((v) => v.includes('end_frame'))).toBe(true)
  })

  it('違反を 1 つで止めずすべて列挙する', () => {
    const limited = makeModel({
      id: 'limited',
      capabilities: {
        aspectRatios: ['9:16'], fps: [24], seed: false, negativePrompt: false,
      } as never,
    })
    const spec = makeSpec({ seed: 42, negativePrompt: 'blurry' })
    expect(validateAgainstCapabilities(spec, limited).length).toBeGreaterThanOrEqual(4)
  })
})

/**
 * 最初のフレームが無いと使えないモデル（ADR-0025）。ローカルの画像→動画は
 * 画像を動かすだけなので、画像が無ければ何も作れない。
 */
describe('requiresStartFrame', () => {
  const stillMotion = makeModel({
    id: 'local/still-motion',
    capabilities: {
      referenceImages: { max: 1, roles: ['start_frame'] },
      requiresStartFrame: true,
    } as never,
  })

  it('最初のフレームが無ければ違反にする', () => {
    expect(validateAgainstCapabilities(makeSpec(), stillMotion).join()).toContain('最初のフレーム')
  })

  it('最初のフレームがあれば通す', () => {
    const spec = makeSpec({ references: [{ mediaAssetId: asset(), role: 'start_frame', weight: 1 }] })

    expect(validateAgainstCapabilities(spec, stillMotion)).toEqual([])
  })

  it('宣言していないモデルは、最初のフレームが無くても通す（既定は要らない）', () => {
    expect(validateAgainstCapabilities(makeSpec(), makeModel({ id: 'plain' }))).toEqual([])
  })
})
