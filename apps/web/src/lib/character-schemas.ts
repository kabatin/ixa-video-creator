import {
  Character,
  CharacterIdentityImage,
  CharacterLook,
  CharacterLookImage,
  CreateCharacterIdentityImageInput,
  CreateCharacterInput,
  CreateCharacterLookImageInput,
  CreateCharacterLookInput,
  MediaAssetId,
  UpdateCharacterLookPatch,
  UpdateCharacterPatch,
} from '@ixa/domain'
import { z } from 'zod'

/**
 * Character / Look のワイヤ表現（docs/ARCHITECTURE.md §8）。
 * JSON には Date が無いため、ドメインのスキーマの日時列だけを coerce に差し替える。
 * それ以外の制約（ULID / role / key の形）はドメイン定義をそのまま使う。
 */

export const WireCharacter = Character.extend({ createdAt: z.coerce.date() })
export type WireCharacter = z.infer<typeof WireCharacter>

export const WireCharacterList = z.array(WireCharacter)

/** 識別画像と Look には日時列が無いので、ドメインのスキーマをそのまま使う。 */
export const WireIdentityImage = CharacterIdentityImage
export const WireIdentityImageList = z.array(WireIdentityImage)

export const WireLook = CharacterLook
export const WireLookList = z.array(WireLook)

export const WireLookImage = CharacterLookImage
export const WireLookImageList = z.array(WireLookImage)

/** `POST /characters` の本文。 */
export const CreateCharacterBody = CreateCharacterInput
export type CreateCharacterBody = z.input<typeof CreateCharacterBody>

/** `PATCH /characters/{id}` の本文。workspaceId は変更できない。 */
export const UpdateCharacterBody = UpdateCharacterPatch
export type UpdateCharacterBody = z.input<typeof UpdateCharacterBody>

/** `POST /characters/{id}/identity-images` の本文。characterId はパスで渡す。 */
export const CreateIdentityImageBody = CreateCharacterIdentityImageInput.omit({
  characterId: true,
})
export type CreateIdentityImageBody = z.input<typeof CreateIdentityImageBody>

/** `POST /characters/{id}/looks` の本文。characterId はパスで渡す。 */
export const CreateLookBody = CreateCharacterLookInput.omit({ characterId: true })
export type CreateLookBody = z.input<typeof CreateLookBody>

/** `PATCH /looks/{id}` の本文。key は変更できない（Shot からの参照が切れるため）。 */
export const UpdateLookBody = UpdateCharacterLookPatch
export type UpdateLookBody = z.input<typeof UpdateLookBody>

/** `POST /looks/{id}/images` の本文。lookId はパスで渡す。 */
export const CreateLookImageBody = CreateCharacterLookImageInput.omit({ lookId: true })
export type CreateLookImageBody = z.input<typeof CreateLookImageBody>

/** `POST /looks/{id}/canonical-frame` の本文。 */
export const SetCanonicalFrameBody = z.object({ mediaAssetId: MediaAssetId })
export type SetCanonicalFrameBody = z.input<typeof SetCanonicalFrameBody>
