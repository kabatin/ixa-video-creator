import { describe, expect, it } from 'vitest'
import {
  initialCharacterFormValues,
  validateCharacterForm,
  type CharacterFormValues,
} from '@/lib/character-form'
import { initialLookFormValues, validateLookForm, type LookFormValues } from '@/lib/look-form'

const characterValues = (overrides: Partial<CharacterFormValues> = {}): CharacterFormValues => ({
  ...initialCharacterFormValues(),
  name: 'takepi',
  displayName: 'タケピ',
  ...overrides,
})

const lookValues = (overrides: Partial<LookFormValues> = {}): LookFormValues => ({
  ...initialLookFormValues(),
  key: 'IXA_CUP_PAST',
  name: 'iXA CUP 2019',
  ...overrides,
})

describe('validateCharacterForm', () => {
  it('配列をそのままの順序でドメイン入力へ渡す', () => {
    const result = validateCharacterForm(
      characterValues({
        identityAnchors: ['20代日本人男性', '細身', '切れ長の鋭い目'],
        styleTokens: ['硬質な光'],
        colorPalette: ['#1A1A1A', '#FFD200'],
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.identityAnchors).toEqual(['20代日本人男性', '細身', '切れ長の鋭い目'])
    expect(result.input.colorPalette).toEqual(['#1A1A1A', '#FFD200'])
  })

  it('名前と表示名の未入力をフィールド単位で報告する', () => {
    const noName = validateCharacterForm(characterValues({ name: '   ' }))
    expect(noName.ok).toBe(false)
    expect(noName.ok ? {} : noName.errors).toHaveProperty('name')

    const noDisplayName = validateCharacterForm(
      characterValues({ displayName: '' }),
    )
    expect(noDisplayName.ok).toBe(false)
    expect(noDisplayName.ok ? {} : noDisplayName.errors).toHaveProperty('displayName')
  })

  it('長すぎる名前はドメインの制約で弾かれる', () => {
    const result = validateCharacterForm(
      characterValues({ name: 'a'.repeat(101) }),
    )

    expect(result.ok).toBe(false)
    expect(result.ok ? {} : result.errors).toHaveProperty('name')
  })

  it('説明の前後の空白を落とす', () => {
    const result = validateCharacterForm(
      characterValues({ description: '  主人公  ' }),
    )

    expect(result.ok && result.input.description).toBe('主人公')
  })

  it('初期値は空の配列を持つ（カンマ区切りの文字列ではない）', () => {
    expect(initialCharacterFormValues().identityAnchors).toEqual([])
  })
})

describe('validateLookForm', () => {
  it('key と名前が揃えば Look 入力を作る', () => {
    const result = validateLookForm(
      lookValues({ era: ' 2019 ', wardrobeTokens: ['黒髪短髪', 'iXA 2019 ユニフォーム'] }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.key).toBe('IXA_CUP_PAST')
    expect(result.input.era).toBe('2019')
    expect(result.input.wardrobeTokens).toEqual(['黒髪短髪', 'iXA 2019 ユニフォーム'])
    expect(result.input.canonicalFrameAssetId).toBeNull()
  })

  it('era が空なら null にする', () => {
    const result = validateLookForm(lookValues({ era: '   ' }))
    expect(result.ok && result.input.era).toBeNull()
  })

  it('小文字や空白を含む key を弾く', () => {
    expect(validateLookForm(lookValues({ key: 'ixa_cup_past' })).ok).toBe(false)
    expect(validateLookForm(lookValues({ key: 'IXA CUP' })).ok).toBe(false)
  })

  it('key と名前の未入力を報告する', () => {
    const noKey = validateLookForm(lookValues({ key: '' }))
    expect(noKey.ok ? {} : noKey.errors).toHaveProperty('key')

    const noName = validateLookForm(lookValues({ name: '  ' }))
    expect(noName.ok ? {} : noName.errors).toHaveProperty('name')
  })
})
