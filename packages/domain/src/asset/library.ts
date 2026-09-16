import { z } from 'zod'
import {
  BrandAssetId, LocationId, MediaAssetId, MotionTemplateId, WorkspaceId,
} from '../common/ids.js'

export const BrandCategory = z.enum([
  'logo', 'color', 'font', 'uniform', 'typography', 'texture', 'other',
])
export type BrandCategory = z.infer<typeof BrandCategory>

export const BrandAsset = z.object({
  id: BrandAssetId,
  workspaceId: WorkspaceId,
  category: BrandCategory,
  name: z.string().min(1),
  mediaAssetId: MediaAssetId.nullable(),
  /** color なら '#FFD200' のような値。 */
  value: z.string().nullable(),
  /** Brand Review が読む運用ルール。 */
  usageRule: z.string().default(''),
})
export type BrandAsset = z.infer<typeof BrandAsset>

export const Location = z.object({
  id: LocationId,
  workspaceId: WorkspaceId,
  name: z.string().min(1),
  description: z.string().default(''),
  referenceAssetIds: z.array(MediaAssetId).default([]),
})
export type Location = z.infer<typeof Location>

export const MotionTemplate = z.object({
  id: MotionTemplateId,
  workspaceId: WorkspaceId,
  /** Remotion composition id と 1:1 で対応させる。 */
  key: z.string().min(1),
  name: z.string().min(1),
  paramsSchema: z.record(z.unknown()),
  previewAssetId: MediaAssetId.nullable(),
})
export type MotionTemplate = z.infer<typeof MotionTemplate>

// ---------------------------------------------------------------------------
// リポジトリの入力型（ADR-0007）
// ---------------------------------------------------------------------------

export const CreateBrandAssetInput = BrandAsset.omit({ id: true })
export type CreateBrandAssetInput = z.input<typeof CreateBrandAssetInput>

export const UpdateBrandAssetPatch = BrandAsset.pick({
  category: true, name: true, mediaAssetId: true, value: true, usageRule: true,
}).partial()
export type UpdateBrandAssetPatch = z.input<typeof UpdateBrandAssetPatch>

export const CreateLocationInput = Location.omit({ id: true })
export type CreateLocationInput = z.input<typeof CreateLocationInput>

export const UpdateLocationPatch = Location.pick({
  name: true, description: true, referenceAssetIds: true,
}).partial()
export type UpdateLocationPatch = z.input<typeof UpdateLocationPatch>

export const CreateMotionTemplateInput = MotionTemplate.omit({ id: true })
export type CreateMotionTemplateInput = z.input<typeof CreateMotionTemplateInput>
