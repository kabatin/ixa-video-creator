import { z } from 'zod'
import {
  CharacterId, CharacterIdentityImageId, CharacterLookId,
  CharacterLookImageId, MediaAssetId, WorkspaceId,
} from '../common/ids.js'

/**
 * 四面図（正面/側面/背面/斜めを 1 枚に集約したターンアラウンドシート）。
 * Veo と Runway は参照画像を 3 枚しか受け付けないため、
 * 個別画像ではなく四面図 1 枚で渡すことで参照枠を節約する（ARCHITECTURE.md §8）。
 */
export const IdentityImageRole = z.enum([
  'four_view', 'face_front', 'face_side', 'face_three_quarter', 'full_body', 'profile',
])
export type IdentityImageRole = z.infer<typeof IdentityImageRole>

export const LookImageRole = z.enum(['wardrobe', 'hair', 'full_body', 'reference_still'])
export type LookImageRole = z.infer<typeof LookImageRole>

/**
 * Character は「同一性」だけを持つ。時系列で変わる外見は CharacterLook が持つ。
 * プロンプト断片を役割ごとに分けるのは、再生成時に部分調整できるようにするため。
 */
export const Character = z.object({
  id: CharacterId,
  workspaceId: WorkspaceId,
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().default(''),

  identityAnchors: z.array(z.string()).default([]),
  styleTokens: z.array(z.string()).default([]),
  colorPalette: z.array(z.string()).default([]),

  createdAt: z.date(),
})
export type Character = z.infer<typeof Character>

export const CharacterIdentityImage = z.object({
  id: CharacterIdentityImageId,
  characterId: CharacterId,
  mediaAssetId: MediaAssetId,
  role: IdentityImageRole,
  isPrimary: z.boolean().default(false),
  order: z.number().int().nonnegative(),
})
export type CharacterIdentityImage = z.infer<typeof CharacterIdentityImage>

export const CharacterLook = z.object({
  id: CharacterLookId,
  characterId: CharacterId,
  key: z.string().regex(/^[A-Z0-9_]+$/, 'key は大文字英数とアンダースコアのみ'),
  name: z.string().min(1),
  era: z.string().nullable(),
  description: z.string().default(''),

  wardrobeTokens: z.array(z.string()).default([]),
  styleTokens: z.array(z.string()).default([]),
  colorPalette: z.array(z.string()).default([]),

  isDefault: z.boolean().default(false),

  /**
   * この Look の canonical reference。
   * 最初に承認された Take の 1 フレームを昇格させ、以降の全 Shot で使ってドリフトを止める。
   */
  canonicalFrameAssetId: MediaAssetId.nullable(),
})
export type CharacterLook = z.infer<typeof CharacterLook>

export const CharacterLookImage = z.object({
  id: CharacterLookImageId,
  lookId: CharacterLookId,
  mediaAssetId: MediaAssetId,
  role: LookImageRole,
  isPrimary: z.boolean().default(false),
  order: z.number().int().nonnegative(),
})
export type CharacterLookImage = z.infer<typeof CharacterLookImage>

// ---------------------------------------------------------------------------
// リポジトリの入力型（ADR-0007: 契約は Domain が定義する）
// ---------------------------------------------------------------------------

export const CreateCharacterInput = Character.omit({ id: true, createdAt: true })
export type CreateCharacterInput = z.input<typeof CreateCharacterInput>

/** workspaceId は変更できない。キャラクターを別ワークスペースへ移す操作は想定しない。 */
export const UpdateCharacterPatch = Character.pick({
  name: true, displayName: true, description: true,
  identityAnchors: true, styleTokens: true, colorPalette: true,
}).partial()
export type UpdateCharacterPatch = z.input<typeof UpdateCharacterPatch>

export const CreateCharacterIdentityImageInput = CharacterIdentityImage.omit({ id: true })
export type CreateCharacterIdentityImageInput = z.input<typeof CreateCharacterIdentityImageInput>

export const CreateCharacterLookInput = CharacterLook.omit({ id: true })
export type CreateCharacterLookInput = z.input<typeof CreateCharacterLookInput>

/**
 * characterId と key は変更できない。
 * key は Shot から Look を指す識別子なので、変えると参照が切れる。
 */
export const UpdateCharacterLookPatch = CharacterLook.pick({
  name: true, era: true, description: true,
  wardrobeTokens: true, styleTokens: true, colorPalette: true,
  isDefault: true, canonicalFrameAssetId: true,
}).partial()
export type UpdateCharacterLookPatch = z.input<typeof UpdateCharacterLookPatch>

export const CreateCharacterLookImageInput = CharacterLookImage.omit({ id: true })
export type CreateCharacterLookImageInput = z.input<typeof CreateCharacterLookImageInput>
