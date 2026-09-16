import { z } from 'zod'
import { MediaAssetId, ShotId, ShotReferenceId } from '../common/ids.js'

export const ReferenceRole = z.enum([
  'subject', 'wardrobe', 'location', 'style', 'brand',
  'start_frame', 'end_frame', 'previous_shot_last_frame',
])
export type ReferenceRole = z.infer<typeof ReferenceRole>

export const ReferenceSourceKind = z.enum([
  'manual', 'derived_character', 'derived_look', 'derived_location', 'derived_brand',
])
export type ReferenceSourceKind = z.infer<typeof ReferenceSourceKind>

export const ShotReference = z.object({
  id: ShotReferenceId,
  shotId: ShotId,
  mediaAssetId: MediaAssetId,
  role: ReferenceRole,
  weight: z.number().min(0).max(1).default(1),
  order: z.number().int().nonnegative(),
  sourceKind: ReferenceSourceKind,
})
export type ShotReference = z.infer<typeof ShotReference>

export const CreateShotReferenceInput = ShotReference.omit({ id: true })
export type CreateShotReferenceInput = z.input<typeof CreateShotReferenceInput>

/**
 * 参照の切り詰め優先度。数値が小さいほど優先される。
 * モデルの参照枚数上限（Veo/Runway は 3 枚）に合わせて削るときに使う。
 * この順序がキャラクター一貫性の品質を決めるため、必ずテストすること。
 */
export const REFERENCE_PRIORITY: Readonly<Record<ReferenceRole, number>> = Object.freeze({
  subject: 2,
  start_frame: 3,
  wardrobe: 4,
  previous_shot_last_frame: 5,
  location: 6,
  brand: 7,
  end_frame: 8,
  style: 9,
})

/** 手動追加は常に最優先（ARCHITECTURE.md §8）。 */
export const MANUAL_PRIORITY = 0
export const CANONICAL_FRAME_PRIORITY = 1

export const referencePriority = (ref: Pick<ShotReference, 'role' | 'sourceKind'>): number =>
  ref.sourceKind === 'manual' ? MANUAL_PRIORITY : REFERENCE_PRIORITY[ref.role]
