import { describe, expect, it } from 'vitest'
import { CharacterId, CharacterLookId, MediaAssetId, ShotId, ShotReferenceId } from '../common/ids.js'
import { resolveReferences } from '../generation/reference-resolver.js'
import type { CharacterBundle, ResolveInput } from '../generation/reference-resolver.js'

const asset = (n: number) => MediaAssetId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${n.toString().padStart(2, '0')}`)
const ALL_ROLES = [
  'subject', 'wardrobe', 'location', 'style', 'brand',
  'start_frame', 'end_frame', 'previous_shot_last_frame',
] as const

const bundle = (opts: { fourView?: boolean; canonical?: boolean } = {}): CharacterBundle => ({
  character: {
    id: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    workspaceId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW') as never,
    name: 'takepi', displayName: 'takepi', description: '',
    identityAnchors: ['細身'], styleTokens: [], colorPalette: [], createdAt: new Date(),
  },
  look: {
    id: CharacterLookId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'),
    characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    key: 'IXA_CUP_PAST', name: '2019', era: '2019', description: '',
    wardrobeTokens: ['ユニフォーム'], styleTokens: [], colorPalette: [],
    isDefault: true,
    canonicalFrameAssetId: opts.canonical ? asset(90) : null,
  },
  identityImages: [
    ...(opts.fourView
      ? [{ id: ShotReferenceId.parse('01ARZ3NDEKTSV4RRFFQ69G5F80') as never, characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), mediaAssetId: asset(1), role: 'four_view' as const, isPrimary: true, order: 0 }]
      : []),
    { id: ShotReferenceId.parse('01ARZ3NDEKTSV4RRFFQ69G5F81') as never, characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), mediaAssetId: asset(2), role: 'face_front' as const, isPrimary: true, order: 1 },
    { id: ShotReferenceId.parse('01ARZ3NDEKTSV4RRFFQ69G5F82') as never, characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), mediaAssetId: asset(3), role: 'face_side' as const, isPrimary: false, order: 2 },
    { id: ShotReferenceId.parse('01ARZ3NDEKTSV4RRFFQ69G5F83') as never, characterId: CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), mediaAssetId: asset(4), role: 'full_body' as const, isPrimary: false, order: 3 },
  ],
  lookImages: [
    { id: ShotReferenceId.parse('01ARZ3NDEKTSV4RRFFQ69G5F84') as never, lookId: CharacterLookId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'), mediaAssetId: asset(5), role: 'wardrobe' as const, isPrimary: true, order: 0 },
  ],
})

const base = (overrides: Partial<ResolveInput> = {}): ResolveInput => ({
  characters: [bundle()],
  locations: [],
  manualReferences: [],
  previousShotLastFrameId: null,
  startFrameId: null,
  styleReferenceIds: [],
  maxReferences: 9,
  supportedRoles: ALL_ROLES,
  ...overrides,
})

describe('resolveReferences', () => {
  it('人物の同一性と衣装を展開する', () => {
    const refs = resolveReferences(base())
    expect(refs.some((r) => r.role === 'subject')).toBe(true)
    expect(refs.some((r) => r.role === 'wardrobe')).toBe(true)
  })

  it('参照枠が 3 枚のときは四面図 1 枚に集約して衣装と背景の枠を空ける', () => {
    const refs = resolveReferences(
      base({ characters: [bundle({ fourView: true })], maxReferences: 3 }),
    )
    const subjects = refs.filter((r) => r.role === 'subject')
    expect(subjects).toHaveLength(1)
    expect(subjects[0]?.origin).toContain('four_view')
    // 衣装の枠が残っていること
    expect(refs.some((r) => r.role === 'wardrobe')).toBe(true)
  })

  it('参照枠が多いときは個別の識別画像を使う', () => {
    const refs = resolveReferences(base({ characters: [bundle({ fourView: true })], maxReferences: 9 }))
    expect(refs.filter((r) => r.role === 'subject').length).toBeGreaterThan(1)
  })

  it('Look の canonical frame が最優先される（ドリフト防止）', () => {
    const refs = resolveReferences(base({ characters: [bundle({ canonical: true })], maxReferences: 2 }))
    expect(refs[0]?.origin).toContain('canonical')
  })

  it('手動追加は canonical より優先される', () => {
    const refs = resolveReferences(base({
      characters: [bundle({ canonical: true })],
      manualReferences: [{
        id: ShotReferenceId.parse('01ARZ3NDEKTSV4RRFFQ69G5F85'),
        shotId: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
        mediaAssetId: asset(50), role: 'style', weight: 1, order: 0, sourceKind: 'manual',
      }],
      maxReferences: 1,
    }))
    expect(refs).toHaveLength(1)
    expect(refs[0]?.origin).toBe('manual')
  })

  it('モデルが対応しないロールを落とす', () => {
    const refs = resolveReferences(base({ supportedRoles: ['subject'] }))
    expect(refs.every((r) => r.role === 'subject')).toBe(true)
  })

  it('上限を超えて返さない', () => {
    const refs = resolveReferences(base({ maxReferences: 2 }))
    expect(refs).toHaveLength(2)
  })

  it('同じアセットが重複しない', () => {
    const refs = resolveReferences(base({ startFrameId: asset(2) }))
    const ids = refs.map((r) => r.mediaAssetId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('前 Shot の最終フレームを連続性の参照として積む', () => {
    const refs = resolveReferences(base({ previousShotLastFrameId: asset(7) }))

    const continuity = refs.find((r) => r.mediaAssetId === asset(7))
    expect(continuity?.role).toBe('previous_shot_last_frame')
  })

  it('開始画像を明示したら連続性フレームは積まない（ADR-0016）', () => {
    const refs = resolveReferences(
      base({ startFrameId: asset(6), previousShotLastFrameId: asset(7) }),
    )

    // どちらも Provider の開始画像 1 枠に落ちる。明示した指定が勝つ。
    expect(refs.find((r) => r.mediaAssetId === asset(6))?.role).toBe('start_frame')
    expect(refs.some((r) => r.mediaAssetId === asset(7))).toBe(false)
  })

  it('枠が余っていても開始画像は 2 枚にならない（ADR-0016）', () => {
    const refs = resolveReferences(
      base({ maxReferences: 9, startFrameId: asset(6), previousShotLastFrameId: asset(7) }),
    )

    // 優先度による切り詰めに任せると、上限が緩いモデルでは両方残ってしまう。
    const frames = refs.filter(
      (r) => r.role === 'start_frame' || r.role === 'previous_shot_last_frame',
    )
    expect(frames).toHaveLength(1)
  })

  it('同じ入力で必ず同じ結果になる（再現性）', () => {
    const runs = Array.from({ length: 5 }, () => resolveReferences(base({ maxReferences: 3 })))
    const serialized = runs.map((r) => JSON.stringify(r.map((x) => x.mediaAssetId)))
    expect(new Set(serialized).size).toBe(1)
  })
})

/**
 * 作品の手本画像（ムードボード、ADR-0030）。全 Shot の生成に見た目の手本（役割 `style`）として添える。
 * **1 枚目は人物の次に優先**（上限 4 枚でも必ず 1 枚届く）。2・3 枚目は空きがあれば。
 */
describe('resolveReferences — 作品の手本画像', () => {
  const mood = [asset(70), asset(71), asset(72)]
  const styleOf = (refs: ReturnType<typeof resolveReferences>) =>
    refs.filter((ref) => ref.role === 'style').map((ref) => ref.mediaAssetId)

  it('枠に余裕があれば 3 枚とも添える', () => {
    expect(styleOf(resolveReferences(base({ styleReferenceIds: mood })))).toEqual(mood)
  })

  it('上限 4 枚でも 1 枚目は人物の次に残る（衣装・場所より先）', () => {
    const refs = resolveReferences(
      base({
        styleReferenceIds: mood,
        locations: [{ name: '雨の路地', referenceAssetIds: [asset(60)] } as never],
        maxReferences: 4,
      }),
    )
    expect(styleOf(refs)).toEqual([asset(70)])
    expect(refs.filter((ref) => ref.role === 'subject')).toHaveLength(3)
  })

  it('最初のフレームより先にはしない（開始画像は動画の始点そのもの）', () => {
    const refs = resolveReferences(
      base({ characters: [], styleReferenceIds: mood, startFrameId: asset(50), maxReferences: 1 }),
    )
    expect(refs.map((ref) => ref.role)).toEqual(['start_frame'])
  })

  it('手本を受けないモデルには渡さない', () => {
    const roles = ALL_ROLES.filter((role) => role !== 'style')
    expect(styleOf(resolveReferences(base({ styleReferenceIds: mood, supportedRoles: roles })))).toEqual([])
  })
})
