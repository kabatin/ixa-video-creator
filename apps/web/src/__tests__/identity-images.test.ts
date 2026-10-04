import { CharacterIdentityImage, IdentityImageRole } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  FOUR_VIEW_ROLE,
  IDENTITY_ROLE_OPTIONS,
  countByRole,
  hasFourView,
  primaryImageOfRole,
  summarizeIdentityImages,
} from '@/lib/identity-images'
import { MEDIA_ID, identityImageJson } from '@/__tests__/fixtures'

const image = (
  overrides: Partial<{ id: string; role: IdentityImageRole; isPrimary: boolean; order: number }>,
): CharacterIdentityImage =>
  CharacterIdentityImage.parse({ ...identityImageJson, ...overrides })

describe('hasFourView', () => {
  it('four_view が 1 枚でもあれば true', () => {
    expect(hasFourView([image({ role: 'four_view' })])).toBe(true)
  })

  it('個別画像だけなら false（参照枠を節約できない）', () => {
    expect(
      hasFourView([
        image({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD1', role: 'face_front' }),
        image({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD2', role: 'face_side' }),
        image({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD3', role: 'full_body' }),
      ]),
    ).toBe(false)
  })

  it('1 枚も無ければ false', () => {
    expect(hasFourView([])).toBe(false)
  })

  it('判定に使う role はドメインの enum から取る', () => {
    expect(FOUR_VIEW_ROLE).toBe(IdentityImageRole.enum.four_view)
  })
})

describe('summarizeIdentityImages', () => {
  it('枚数と四面図の有無をまとめる', () => {
    const summary = summarizeIdentityImages([
      image({ role: 'face_front' }),
      image({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD4', role: 'four_view' }),
    ])

    expect(summary).toEqual({ total: 2, hasFourView: true, hasAny: true })
  })

  it('空なら hasAny も false', () => {
    expect(summarizeIdentityImages([])).toEqual({ total: 0, hasFourView: false, hasAny: false })
  })
})

describe('primaryImageOfRole', () => {
  it('同じ role の主画像を引く', () => {
    const primary = image({ role: 'face_front', isPrimary: true })
    const other = image({ id: '01ARZ3NDEKTSV4RRFFQ69G5FD5', role: 'face_front', isPrimary: false })

    expect(primaryImageOfRole([other, primary], 'face_front')?.id).toBe(primary.id)
  })

  it('別 role の主画像は引かない', () => {
    const primary = image({ role: 'four_view', isPrimary: true })
    expect(primaryImageOfRole([primary], 'full_body')).toBeUndefined()
  })
})

describe('countByRole', () => {
  it('ドメインの enum に定義された role をすべて含む', () => {
    const counts = countByRole([image({ role: 'four_view' })])

    expect([...counts.keys()]).toEqual([...IdentityImageRole.options])
    expect(counts.get('four_view')).toBe(1)
    expect(counts.get('face_side')).toBe(0)
  })
})

describe('IDENTITY_ROLE_OPTIONS', () => {
  it('選択肢を文字列でハードコードせずドメインの enum から作る', () => {
    expect(IDENTITY_ROLE_OPTIONS.map((option) => option.value)).toEqual([
      ...IdentityImageRole.options,
    ])
  })
})

describe('fixtures', () => {
  it('識別画像は MediaAsset を指す', () => {
    expect(image({}).mediaAssetId).toBe(MEDIA_ID)
  })
})
