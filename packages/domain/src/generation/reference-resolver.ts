import type { MediaAssetId } from '../common/ids.js'
import type { Character, CharacterIdentityImage, CharacterLook, CharacterLookImage } from '../character/character.js'
import type { Location } from '../asset/library.js'
import type { ReferenceRole, ShotReference } from '../shot/reference.js'
import { CANONICAL_FRAME_PRIORITY, MANUAL_PRIORITY, REFERENCE_PRIORITY } from '../shot/reference.js'

/** 四面図は 1 枚で正面・側面・背面・斜めを兼ねるため、枠が少ないモデルで優先される。 */
export const FOUR_VIEW_PRIORITY = 1.5

/**
 * 作品の手本画像（ADR-0030）の 1 枚目。**人物と最初のフレームの次、衣装・場所より先。**
 * 参照の上限（Codex は 4 枚）でも作品の見た目の手本が必ず 1 枚届くようにする。
 * 最初のフレーム（3）より後ろなのは、開始画像が動画の始点そのものだから。
 */
export const STYLE_REFERENCE_LEAD_PRIORITY = 3.5

export type ResolvedReference = {
  readonly mediaAssetId: MediaAssetId
  readonly role: ReferenceRole
  readonly weight: number
  /** 切り詰めの優先度。小さいほど残る。 */
  readonly priority: number
  /** なぜこの参照が入ったか。監査とデバッグのため。 */
  readonly origin: string
}

export type CharacterBundle = {
  readonly character: Character
  readonly look: CharacterLook
  readonly identityImages: readonly CharacterIdentityImage[]
  readonly lookImages: readonly CharacterLookImage[]
}

export type ResolveInput = {
  readonly characters: readonly CharacterBundle[]
  readonly locations: readonly Location[]
  readonly manualReferences: readonly ShotReference[]
  readonly previousShotLastFrameId: MediaAssetId | null
  readonly startFrameId: MediaAssetId | null
  /**
   * 作品の手本画像（`Project.styleReferenceAssetIds`、ADR-0030）。**必ず渡す**（無ければ空配列）。
   * 省略できる形にすると、渡し忘れた経路だけ作品の見た目が揃わない。
   */
  readonly styleReferenceIds: readonly MediaAssetId[]
  /** モデルが受け付ける参照枚数の上限。 */
  readonly maxReferences: number
  /** モデルが受け付ける参照ロール。 */
  readonly supportedRoles: readonly ReferenceRole[]
}

/**
 * Shot から Provider へ渡す参照画像を解決する。
 *
 * **この切り詰め規則がキャラクター一貫性の品質を決める**（ARCHITECTURE.md §8）。
 * Veo と Runway は 3 枚しか受け付けないため、何を捨てるかが結果を左右する。
 */
export const resolveReferences = (input: ResolveInput): ResolvedReference[] => {
  const candidates: ResolvedReference[] = []
  const tight = input.maxReferences < 4

  // 手動追加は常に最優先
  for (const ref of input.manualReferences) {
    candidates.push({
      mediaAssetId: ref.mediaAssetId,
      role: ref.role,
      weight: ref.weight,
      priority: MANUAL_PRIORITY,
      origin: 'manual',
    })
  }

  for (const bundle of input.characters) {
    const { character, look } = bundle

    // Look の canonical frame があれば最優先。承認済みの絵なのでドリフトを止められる。
    if (look.canonicalFrameAssetId !== null) {
      candidates.push({
        mediaAssetId: look.canonicalFrameAssetId,
        role: 'subject',
        weight: 1,
        priority: CANONICAL_FRAME_PRIORITY,
        origin: `canonical:${character.name}/${look.key}`,
      })
    }

    // 参照枠が少ないときは四面図 1 枚に集約して枠を節約する
    const fourView = bundle.identityImages.find((img) => img.role === 'four_view')
    if (tight && fourView) {
      candidates.push({
        mediaAssetId: fourView.mediaAssetId,
        role: 'subject',
        weight: 1,
        priority: FOUR_VIEW_PRIORITY,
        origin: `four_view:${character.name}`,
      })
    } else {
      const identity = [...bundle.identityImages].sort(byPrimaryThenOrder)
      for (const img of identity) {
        candidates.push({
          mediaAssetId: img.mediaAssetId,
          role: 'subject',
          weight: img.isPrimary ? 1 : 0.7,
          priority: REFERENCE_PRIORITY.subject + (img.isPrimary ? 0 : 0.1),
          origin: `identity:${character.name}/${img.role}`,
        })
      }
    }

    const wardrobe = [...bundle.lookImages].sort(byPrimaryThenOrder)
    for (const img of wardrobe) {
      candidates.push({
        mediaAssetId: img.mediaAssetId,
        role: 'wardrobe',
        weight: img.isPrimary ? 1 : 0.7,
        priority: REFERENCE_PRIORITY.wardrobe + (img.isPrimary ? 0 : 0.1),
        origin: `look:${character.name}/${look.key}/${img.role}`,
      })
    }
  }

  if (input.startFrameId !== null) {
    candidates.push({
      mediaAssetId: input.startFrameId,
      role: 'start_frame',
      weight: 1,
      priority: REFERENCE_PRIORITY.start_frame,
      origin: 'keyframe',
    })
  }

  /**
   * **明示したキーフレームがあるときは連続性フレームを積まない**（ADR-0016）。
   * どちらも Provider の「開始画像」1 枠に落ちるため、両方渡すと同じ枠を奪い合う。
   * 捨てるのは推測のほう。`start_frame` は利用者が始点を明示した指定である。
   *
   * 優先度による切り詰めに任せないのは、枠が余っているモデル（上限 9 枚など）では
   * 落ちずに開始画像が 2 枚ある仕様ができあがるため。
   */
  if (input.previousShotLastFrameId !== null && input.startFrameId === null) {
    candidates.push({
      mediaAssetId: input.previousShotLastFrameId,
      role: 'previous_shot_last_frame',
      weight: 0.8,
      priority: REFERENCE_PRIORITY.previous_shot_last_frame,
      origin: 'continuity',
    })
  }

  for (const location of input.locations) {
    for (const [index, assetId] of location.referenceAssetIds.entries()) {
      candidates.push({
        mediaAssetId: assetId,
        role: 'location',
        weight: 0.8,
        priority: REFERENCE_PRIORITY.location + index * 0.1,
        origin: `location:${location.name}`,
      })
    }
  }

  // 作品の手本画像。1 枚目は上の優先度、2 枚目以降は空きがあれば（`style` の優先度）。
  for (const [index, assetId] of input.styleReferenceIds.entries()) {
    candidates.push({
      mediaAssetId: assetId,
      role: 'style',
      weight: 0.8,
      priority: index === 0 ? STYLE_REFERENCE_LEAD_PRIORITY : REFERENCE_PRIORITY.style + index * 0.1,
      origin: `project_style:${String(index + 1)}`,
    })
  }

  // モデルが対応しないロールは落とす
  const supported = candidates.filter((c) => input.supportedRoles.includes(c.role))

  // 同じアセットが複数経路で入ったら優先度が高いほうだけ残す
  const deduped = new Map<string, ResolvedReference>()
  for (const c of supported) {
    const existing = deduped.get(c.mediaAssetId)
    if (!existing || c.priority < existing.priority) deduped.set(c.mediaAssetId, c)
  }

  // 優先度順に切り詰める。同順位は origin で安定化する（再現性のため）
  return [...deduped.values()]
    .sort((a, b) => a.priority - b.priority || (a.origin < b.origin ? -1 : 1))
    .slice(0, input.maxReferences)
}

const byPrimaryThenOrder = (
  a: { isPrimary: boolean; order: number },
  b: { isPrimary: boolean; order: number },
): number => (a.isPrimary === b.isPrimary ? a.order - b.order : a.isPrimary ? -1 : 1)
