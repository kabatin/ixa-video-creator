import { z } from 'zod'
import { UpdateBrandAssetPatch, UpdateLocationPatch } from '../asset/library.js'
import { UpdateCharacterPatch } from '../character/character.js'
import { BrandAssetId, CharacterId, LocationId, TextStyleId, VoiceProfileId } from '../common/ids.js'
import { UpdateVoiceProfilePatch } from '../narration/voice-profile.js'
import { UpdateTextStylePresetPatch } from '../timeline/text-style.js'

/**
 * 素材（キャラクター・ロケーション・ブランド資産・声・テロップのスタイル）の作る・直す・消すの記録（`asset_edit`。2026-10-19）。
 *
 * どれも論理削除なので、**作った・消したものは ID だけ**を持つ（戻すと同じ ID・同じ中身）。
 * **直したものは変えた欄の、変える前の値だけ**を持つ（その後に直した別の欄は、戻しても残る）。
 * 値の規則は各素材の直す口（`Update*Patch`）から取る。どれも素材そのものの規則を写した形なので、
 * 素材に入っていた値はそのまま読める。
 */

const editsOf = <A extends string, I extends z.ZodTypeAny, B extends z.AnyZodObject>(asset: A, id: I, before: B) =>
  [
    z.object({ asset: z.literal(asset), op: z.literal('create'), id }),
    z.object({ asset: z.literal(asset), op: z.literal('delete'), id }),
    z.object({ asset: z.literal(asset), op: z.literal('update'), id, before }),
  ] as const

export const EditBatchAssetEdit = z.union([
  ...editsOf('character', CharacterId, UpdateCharacterPatch),
  ...editsOf('location', LocationId, UpdateLocationPatch),
  ...editsOf('brand_asset', BrandAssetId, UpdateBrandAssetPatch),
  ...editsOf('voice', VoiceProfileId, UpdateVoiceProfilePatch),
  // テロップのスタイル（保存した見た目。ADR-0028）。消しても当てたテロップの見た目は残る（値を写している）。
  ...editsOf('text_style', TextStyleId, UpdateTextStylePresetPatch),
])
export type EditBatchAssetEdit = z.infer<typeof EditBatchAssetEdit>
export type EditBatchAssetKind = EditBatchAssetEdit['asset']

const ASSET_NOUNS: Readonly<Record<EditBatchAssetKind, string>> = Object.freeze({
  character: 'キャラクター',
  location: 'ロケーション',
  brand_asset: 'ブランド資産',
  voice: '声',
  text_style: 'テロップのスタイル',
})

const VERBS: Readonly<Record<EditBatchAssetEdit['op'], string>> = Object.freeze({
  create: '作る',
  update: '直す',
  delete: '消す',
})

/** 履歴の見出し（「キャラクター「戦子」を消す」）。 */
export const assetEditSummary = (edit: Pick<EditBatchAssetEdit, 'asset' | 'op'>, name: string): string =>
  `${ASSET_NOUNS[edit.asset]}「${name}」を${VERBS[edit.op]}`
