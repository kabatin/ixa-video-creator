import { describe, expect, it } from 'vitest'
import { CharacterId, CharacterIdentityImageId, MediaAssetId } from '../common/ids.js'
import type { CharacterIdentityImage } from '../character/character.js'
import { compileCharacterSheetPrompt, pickSheetReference } from '../character/character-sheet-prompt.js'

/**
 * キャラクターシート（四面図）を作る指示（制作者 2026-10-03「動画生成に役立つ形式のキャラクターシートを
 * 1 枚の画像から作れるといい。正面などの画像を用意したら、それを基に Codex CLI で作る」）。
 * 動画の参照に使うので、4 つの向きの全身を同じ縮尺で並べ、文字は入れない。手本の人物をそのまま描かせる。
 */

const takepi = {
  displayName: '藤本タケピ',
  description: '20代の日本人男性。細身で背が高い',
  identityAnchors: ['切れ長の目', '短い黒髪'],
  styleTokens: ['セル調のアニメ'],
  colorPalette: ['#1A1A1A', '#FFD200'],
}

describe('compileCharacterSheetPrompt', () => {
  const prompt = compileCharacterSheetPrompt(takepi)

  it('四面図として、正面・横・背面・斜めの全身を同じ縮尺で 1 枚に並べさせる', () => {
    expect(prompt).toMatch(/キャラクターシート（四面図）/)
    expect(prompt).toMatch(/正面.*横.*背面.*斜め/s)
    expect(prompt).toMatch(/全身/)
    expect(prompt).toMatch(/同じ縮尺/)
  })

  it('手本の画像の人物をそのまま描かせ、文字・ラベルは入れさせない', () => {
    expect(prompt).toMatch(/手本の画像の人物/)
    expect(prompt).toMatch(/文字.*入れない/)
    expect(prompt).toMatch(/無地/)
  })

  it('キャラクターの特徴・説明・色・画風を渡す', () => {
    expect(prompt).toContain('切れ長の目')
    expect(prompt).toContain('短い黒髪')
    expect(prompt).toContain('細身で背が高い')
    expect(prompt).toContain('#FFD200')
    expect(prompt).toContain('セル調のアニメ')
  })

  it('空の欄は行ごと出さない', () => {
    const bare = compileCharacterSheetPrompt({ ...takepi, description: '', identityAnchors: [], styleTokens: [], colorPalette: [] })
    expect(bare).not.toMatch(/人物の特徴:|説明:|色:|画風:/)
  })
})

describe('pickSheetReference', () => {
  const image = (n: number, role: CharacterIdentityImage['role'], isPrimary = false): CharacterIdentityImage => ({
    id: CharacterIdentityImageId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`),
    characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    mediaAssetId: MediaAssetId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(n + 50).padStart(2, '0')}`),
    role,
    isPrimary,
    order: n,
  })

  it('指定が無ければ、四面図以外の主の画像。主が無ければ最初の 1 枚', () => {
    expect(pickSheetReference([image(1, 'four_view', true), image(2, 'full_body'), image(3, 'face_front', true)])?.order).toBe(3)
    expect(pickSheetReference([image(4, 'full_body'), image(2, 'face_front')])?.order).toBe(2)
  })

  it('指定があればそれ。四面図・ほかの画像の指定は使わない', () => {
    const images = [image(1, 'full_body', true), image(2, 'face_side'), image(3, 'four_view')]
    expect(pickSheetReference(images, images[1]?.id)?.order).toBe(2)
    expect(pickSheetReference(images, images[2]?.id)).toBeNull()
    expect(pickSheetReference(images, CharacterIdentityImageId.parse('01ARZ3NDEKTSV4RRFFQ69G5F99'))).toBeNull()
  })

  it('四面図しか無い・画像が無いなら手本は無い', () => {
    expect(pickSheetReference([image(1, 'four_view', true)])).toBeNull()
    expect(pickSheetReference([])).toBeNull()
  })
})
