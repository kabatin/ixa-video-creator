import { codexCliImageModel, stubGeminiLikeImageModel } from '@ixa/provider-image'
import { describe, expect, it } from 'vitest'
import { cropRectFor, requestShapeFor } from '../shape.js'

/**
 * 絵コンテの画像の大きさ（ADR-0029）。モデルが作れる形で作り、プロジェクトの比に中央で切り抜く。
 * Codex は横長 1536×1024 / 縦長 / 正方形の 3 つしか出さない（実測）。
 */

describe('requestShapeFor', () => {
  it('比と同じ向きの、いちばん大きい形で作る', () => {
    expect(requestShapeFor(codexCliImageModel, '16:9')).toEqual({
      resolution: { width: 1536, height: 1024 },
      aspectRatio: '16:9',
    })
    expect(requestShapeFor(codexCliImageModel, '9:16').resolution).toEqual({ width: 1024, height: 1536 })
    expect(requestShapeFor(stubGeminiLikeImageModel, '16:9').resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('モデルが言わない比は、同じ向きの言える比で頼む（切り抜きで合わせる）', () => {
    expect(requestShapeFor(stubGeminiLikeImageModel, '21:9')).toEqual({
      resolution: { width: 1920, height: 1080 },
      aspectRatio: '16:9',
    })
  })
})

describe('cropRectFor', () => {
  it('横長 3:2 を 16:9 にするなら上下を削る（中央）', () => {
    expect(cropRectFor({ width: 1536, height: 1024 }, '16:9')).toEqual({ x: 0, y: 80, width: 1536, height: 864 })
  })

  it('縦長を 4:5 にするなら上下を削る', () => {
    expect(cropRectFor({ width: 1024, height: 1536 }, '4:5')).toEqual({ x: 0, y: 128, width: 1024, height: 1280 })
  })

  it('正方形を 16:9 にするなら上下を削る。横長を 1:1 にするなら左右を削る', () => {
    expect(cropRectFor({ width: 1024, height: 1024 }, '16:9')).toEqual({ x: 0, y: 224, width: 1024, height: 576 })
    expect(cropRectFor({ width: 1536, height: 1024 }, '1:1')).toEqual({ x: 256, y: 0, width: 1024, height: 1024 })
  })

  it('もう比が合っていれば削らない', () => {
    expect(cropRectFor({ width: 1920, height: 1080 }, '16:9')).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })
})
