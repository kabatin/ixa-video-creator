import { canGenerateImage, validateImageRequest } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { stubGeminiLikeImageModel } from '../stub/descriptor.js'
import { assetId, makeImageModel, makeImageRequest } from './fixtures.js'

const reference = (role: 'subject' | 'wardrobe' | 'end_frame') => ({
  mediaAssetId: assetId(),
  role,
})

describe('validateImageRequest', () => {
  it('満たせる要求では違反ゼロ', () => {
    const model = makeImageModel({ id: 'a' })
    expect(validateImageRequest(makeImageRequest(model), model)).toEqual([])
    expect(canGenerateImage(makeImageRequest(model), model)).toBe(true)
  })

  it('参照画像の枚数超過を弾く', () => {
    const model = makeImageModel({
      id: 'gemini-like',
      capabilities: { referenceImages: { max: 14, roles: ['subject'] } } as never,
    })
    const request = makeImageRequest(model, {
      references: Array.from({ length: 15 }, () => reference('subject')),
    })
    const violations = validateImageRequest(request, model)
    expect(violations.some((v) => v.includes('15 枚') && v.includes('14 枚'))).toBe(true)
  })

  it('上限ちょうどは通す', () => {
    const model = makeImageModel({ id: 'gemini-like' })
    const request = makeImageRequest(model, {
      references: Array.from({ length: 14 }, () => reference('subject')),
    })
    expect(validateImageRequest(request, model)).toEqual([])
  })

  it('未対応の参照ロールを弾く', () => {
    const model = makeImageModel({
      id: 'm',
      capabilities: { referenceImages: { max: 14, roles: ['subject'] } } as never,
    })
    const request = makeImageRequest(model, { references: [reference('end_frame')] })
    expect(validateImageRequest(request, model).some((v) => v.includes('end_frame'))).toBe(true)
  })

  it('違反を 1 つで止めずすべて列挙する', () => {
    const limited = makeImageModel({
      id: 'limited',
      capabilities: {
        referenceImages: { max: 1, roles: ['subject'] },
        resolutions: [{ width: 512, height: 512 }],
        aspectRatios: ['9:16'],
        maskEdit: false,
        seed: false,
        negativePrompt: false,
      } as never,
    })
    const request = makeImageRequest(limited, {
      prompt: '   ',
      resolution: { width: 1024, height: 1024 },
      aspectRatio: '1:1',
      seed: 42,
      negativePrompt: 'blurry',
      references: [reference('subject'), reference('wardrobe')],
      count: 0,
    })

    const violations = validateImageRequest(request, limited)
    // プロンプト空 / 枚数 0 / 解像度 / アスペクト比 / 参照枚数 / 未対応ロール / seed / negative
    expect(violations).toHaveLength(8)
    expect(canGenerateImage(request, limited)).toBe(false)
  })

  it('生成枚数は 1 以上の整数でなければならない', () => {
    const model = makeImageModel({ id: 'a' })
    expect(validateImageRequest(makeImageRequest(model, { count: 0 }), model)).toHaveLength(1)
    expect(validateImageRequest(makeImageRequest(model, { count: 1.5 }), model)).toHaveLength(1)
    expect(validateImageRequest(makeImageRequest(model, { count: 4 }), model)).toEqual([])
  })
})

describe('スタブモデルの capability 宣言', () => {
  it('Gemini を模す（参照 14 枚 / maskEdit なし / seed あり）', () => {
    const caps = stubGeminiLikeImageModel.capabilities
    expect(caps.referenceImages.max).toBe(14)
    expect(caps.maskEdit).toBe(false)
    expect(caps.seed).toBe(true)
    expect(caps.negativePrompt).toBe(false)
  })
})
