import { ReferenceRole } from '@ixa/domain'
import type { MediaAssetId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  FAL_MAX_IMAGE_REFERENCES,
  FAL_SEEDANCE_COST_PER_SECOND_USD,
  FAL_SEEDANCE_COST_PER_SECOND_WITH_VIDEO_USD,
  FAL_SEEDANCE_REFERENCE_TO_VIDEO_PATH,
  falSeedanceReferenceToVideoModel,
  pixelSizeFor,
  resolutionTierFor,
} from '../fal/descriptor.js'
import { buildSeedanceInput, withReferenceMentions } from '../fal/request.js'
import { decodeFalJobRef, encodeFalJobRef } from '../fal/job-ref.js'
import { makeSpec } from './fixtures.js'

const assetId = (n: number): MediaAssetId =>
  `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, 'A')}` as MediaAssetId

const reference = (n: number, role: ReferenceRole) => ({
  mediaAssetId: assetId(n),
  role,
  weight: 1,
})

describe('解像度の段', () => {
  /** fal は画素数ではなく 480p/720p/1080p の段でしか指定できない。短辺で段を決める。 */
  it('短辺で段が決まる（縦でも横でも同じ）', () => {
    expect(resolutionTierFor({ width: 1280, height: 720 })).toBe('720p')
    expect(resolutionTierFor({ width: 720, height: 1280 })).toBe('720p')
    expect(resolutionTierFor({ width: 1920, height: 1080 })).toBe('1080p')
    expect(resolutionTierFor({ width: 854, height: 480 })).toBe('480p')
  })

  it('段に載らない解像度は null（黙って近い段へ丸めない）', () => {
    expect(resolutionTierFor({ width: 1000, height: 800 })).toBeNull()
  })

  it('宣言した解像度はすべて段へ戻せる', () => {
    for (const resolution of falSeedanceReferenceToVideoModel.capabilities.resolutions) {
      expect(resolutionTierFor(resolution)).not.toBeNull()
    }
  })

  it('16:9 の 1080p は 1920x1080（Project の既定と一致する）', () => {
    expect(pixelSizeFor('16:9', '1080p')).toEqual({ width: 1920, height: 1080 })
    expect(falSeedanceReferenceToVideoModel.capabilities.resolutions).toContainEqual({
      width: 1920,
      height: 1080,
    })
  })
})

describe('capability 宣言', () => {
  it('参照画像の上限は 9 枚', () => {
    expect(falSeedanceReferenceToVideoModel.capabilities.referenceImages.max).toBe(
      FAL_MAX_IMAGE_REFERENCES,
    )
  })

  /** モデル側に role の概念が無いため、ドメインの全 role を受ける。 */
  it('ドメインの全 role を受ける', () => {
    expect([...falSeedanceReferenceToVideoModel.capabilities.referenceImages.roles].sort()).toEqual(
      [...ReferenceRole.options].sort(),
    )
  })

  it('音は自前で持つので生成しない宣言になっている', () => {
    expect(falSeedanceReferenceToVideoModel.capabilities.audioGeneration).toBe(false)
  })

  /** 映像入力なしの単価を descriptor に載せる。映像入力ありの単価と取り違えない。 */
  it('descriptor の単価は映像入力なしの $0.3024/秒', () => {
    expect(falSeedanceReferenceToVideoModel.economics.costPerSecondUsd).toBe(
      FAL_SEEDANCE_COST_PER_SECOND_USD,
    )
    expect(FAL_SEEDANCE_COST_PER_SECOND_USD).toBe(0.3024)
    expect(FAL_SEEDANCE_COST_PER_SECOND_WITH_VIDEO_USD).toBe(0.1814)
    expect(FAL_SEEDANCE_COST_PER_SECOND_WITH_VIDEO_USD).toBeLessThan(
      FAL_SEEDANCE_COST_PER_SECOND_USD,
    )
  })

  it('モデル ID にエンドポイントの経路が入っている', () => {
    expect(falSeedanceReferenceToVideoModel.id).toContain(FAL_SEEDANCE_REFERENCE_TO_VIDEO_PATH)
  })
})

describe('buildSeedanceInput', () => {
  const urls = ['https://s3.example.com/a.png?sig=1', 'https://s3.example.com/b.png?sig=2']

  it('尺・段・比率・音の有無を写す', () => {
    const input = buildSeedanceInput({
      spec: makeSpec({ durationSec: 4.2 }),
      generationDurationSec: 5,
      referenceUrls: [],
    })
    expect(input.duration).toBe(5)
    expect(input.resolution).toBe('720p')
    expect(input.aspect_ratio).toBe('16:9')
    expect(input.generate_audio).toBe(false)
    expect(input.image_urls).toBeUndefined()
    expect(input.seed).toBeUndefined()
  })

  it('seed は指定があるときだけ載せる', () => {
    const input = buildSeedanceInput({
      spec: makeSpec({ seed: 42 }),
      generationDurationSec: 4,
      referenceUrls: [],
    })
    expect(input.seed).toBe(42)
  })

  /** 並びは resolveReferences が決めた優先度順。アダプタで並べ替えない。 */
  it('image_urls は spec.references の並びをそのまま保つ', () => {
    const input = buildSeedanceInput({
      spec: makeSpec({ references: [reference(1, 'subject'), reference(2, 'style')] }),
      generationDurationSec: 4,
      referenceUrls: urls,
    })
    expect(input.image_urls).toEqual(urls)
  })

  it('参照の数と URL の数が食い違ったら黙って進まない', () => {
    expect(() =>
      buildSeedanceInput({
        spec: makeSpec({ references: [reference(1, 'subject')] }),
        generationDurationSec: 4,
        referenceUrls: urls,
      }),
    ).toThrow()
  })

  it('段に載らない解像度は黙って丸めず投げる', () => {
    expect(() =>
      buildSeedanceInput({
        spec: makeSpec({ resolution: { width: 1000, height: 800 } }),
        generationDurationSec: 4,
        referenceUrls: [],
      }),
    ).toThrow()
  })
})

describe('withReferenceMentions', () => {
  /** Seedance 2.0 は本文から @Image1 の形で参照を指す。 */
  it('参照があれば @ImageN と role の対応を添える', () => {
    const prompt = withReferenceMentions('takepi が勝利する', [
      reference(1, 'subject'),
      reference(2, 'wardrobe'),
    ])
    expect(prompt).toContain('takepi が勝利する')
    expect(prompt).toContain('@Image1')
    expect(prompt).toContain('subject')
    expect(prompt).toContain('@Image2')
    expect(prompt).toContain('wardrobe')
  })

  it('参照が無ければ本文を変えない', () => {
    expect(withReferenceMentions('takepi が勝利する', [])).toBe('takepi が勝利する')
  })

  /** 既に本文が参照を指しているなら、こちらの解釈を上書きしない。 */
  it('本文が既に @Image を含むなら何も足さない', () => {
    const prompt = '@Image1 の takepi が勝利する'
    expect(withReferenceMentions(prompt, [reference(1, 'subject')])).toBe(prompt)
  })
})

describe('ジョブ参照の符号化', () => {
  /**
   * poll は spec を受け取らないため、尺を持ち回らないと費用を出せない。
   * ハンドルは「不透明で Provider ごとに形が違う」契約なのでここに載せる。
   */
  it('request_id と生成尺を往復できる', () => {
    const ref = encodeFalJobRef('9f3a-1234', 6)
    expect(ref).toContain('9f3a-1234')
    expect(decodeFalJobRef(ref)).toEqual({ requestId: '9f3a-1234', generationDurationSec: 6 })
  })

  it('request_id に区切り文字が混ざっても復元できる', () => {
    expect(decodeFalJobRef(encodeFalJobRef('a:b:c', 4)).requestId).toBe('a:b:c')
  })

  it('壊れた参照は黙って 0 秒にせず投げる', () => {
    expect(() => decodeFalJobRef('9f3a-1234')).toThrow()
    expect(() => decodeFalJobRef('x:9f3a-1234')).toThrow()
    expect(() => decodeFalJobRef('')).toThrow()
  })
})
