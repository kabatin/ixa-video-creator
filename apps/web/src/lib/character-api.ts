import type {
  Character,
  CharacterId,
  CharacterIdentityImage,
  CharacterIdentityImageId,
  CharacterLook,
  CharacterLookId,
  CharacterLookImage,
  CharacterLookImageId,
  MediaAssetId,
  ProjectId,
} from '@ixa/domain'
import {
  CreateCharacterBody,
  CreateIdentityImageBody,
  CreateLookBody,
  CreateLookImageBody,
  SetCanonicalFrameBody,
  UpdateCharacterBody,
  UpdateLookBody,
  WireCharacter,
  WireCharacterList,
  WireIdentityImage,
  WireIdentityImageList,
  WireLook,
  WireLookImage,
  WireLookImageList,
  WireLookList,
} from '@/lib/character-schemas'
import type { Requester } from '@/lib/requester'

/**
 * Character / Look とその参照画像の呼び出し口（docs/ARCHITECTURE.md §8）。
 * `apps/api` は import せず、経路とワイヤ形式の知識だけをここに持つ。
 */

const characterPath = (id: CharacterId, suffix = ''): string =>
  `/characters/${encodeURIComponent(id)}${suffix}`

const lookPath = (id: CharacterLookId, suffix = ''): string =>
  `/looks/${encodeURIComponent(id)}${suffix}`

export type CharacterApi = {
  /** プロジェクトのキャラクター（ADR-0034）。 */
  listCharacters: (projectId: ProjectId) => Promise<Character[]>
  getCharacter: (id: CharacterId) => Promise<Character | null>
  createCharacter: (projectId: ProjectId, input: CreateCharacterBody) => Promise<Character>
  updateCharacter: (id: CharacterId, patch: UpdateCharacterBody) => Promise<Character>
  deleteCharacter: (id: CharacterId) => Promise<void>

  listIdentityImages: (characterId: CharacterId) => Promise<CharacterIdentityImage[]>
  addIdentityImage: (
    characterId: CharacterId,
    input: CreateIdentityImageBody,
  ) => Promise<CharacterIdentityImage>
  removeIdentityImage: (id: CharacterIdentityImageId) => Promise<void>
  /** 同じ role の主画像にする。他の同 role 画像は API 側で解除される。 */
  setPrimaryIdentityImage: (id: CharacterIdentityImageId) => Promise<CharacterIdentityImage>

  listLooks: (characterId: CharacterId) => Promise<CharacterLook[]>
  createLook: (characterId: CharacterId, input: CreateLookBody) => Promise<CharacterLook>
  getLook: (id: CharacterLookId) => Promise<CharacterLook | null>
  updateLook: (id: CharacterLookId, patch: UpdateLookBody) => Promise<CharacterLook>
  deleteLook: (id: CharacterLookId) => Promise<void>

  listLookImages: (lookId: CharacterLookId) => Promise<CharacterLookImage[]>
  addLookImage: (lookId: CharacterLookId, input: CreateLookImageBody) => Promise<CharacterLookImage>
  removeLookImage: (id: CharacterLookImageId) => Promise<void>
  /** 承認 Take のフレームを canonical reference に昇格させ、Look のドリフトを止める。 */
  setCanonicalFrame: (lookId: CharacterLookId, mediaAssetId: MediaAssetId) => Promise<CharacterLook>
}

export const createCharacterApi = (requester: Requester): CharacterApi => ({
  listCharacters: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/characters`, WireCharacterList),

  getCharacter: async (id) => requester.getOrNull(characterPath(id), WireCharacter),

  createCharacter: async (projectId, input) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/characters`,
      CreateCharacterBody.parse(input),
      WireCharacter,
    ),

  updateCharacter: async (id, patch) =>
    requester.patch(characterPath(id), UpdateCharacterBody.parse(patch), WireCharacter),

  deleteCharacter: async (id) => requester.remove(characterPath(id)),

  listIdentityImages: async (characterId) =>
    requester.get(characterPath(characterId, '/identity-images'), WireIdentityImageList),

  addIdentityImage: async (characterId, input) =>
    requester.post(
      characterPath(characterId, '/identity-images'),
      CreateIdentityImageBody.parse(input),
      WireIdentityImage,
    ),

  removeIdentityImage: async (id) => requester.remove(`/identity-images/${encodeURIComponent(id)}`),

  setPrimaryIdentityImage: async (id) =>
    requester.post(
      `/identity-images/${encodeURIComponent(id)}/primary`,
      undefined,
      WireIdentityImage,
    ),

  listLooks: async (characterId) =>
    requester.get(characterPath(characterId, '/looks'), WireLookList),

  createLook: async (characterId, input) =>
    requester.post(characterPath(characterId, '/looks'), CreateLookBody.parse(input), WireLook),

  getLook: async (id) => requester.getOrNull(lookPath(id), WireLook),

  updateLook: async (id, patch) =>
    requester.patch(lookPath(id), UpdateLookBody.parse(patch), WireLook),

  deleteLook: async (id) => requester.remove(lookPath(id)),

  listLookImages: async (lookId) => requester.get(lookPath(lookId, '/images'), WireLookImageList),

  addLookImage: async (lookId, input) =>
    requester.post(lookPath(lookId, '/images'), CreateLookImageBody.parse(input), WireLookImage),

  removeLookImage: async (id) => requester.remove(`/look-images/${encodeURIComponent(id)}`),

  setCanonicalFrame: async (lookId, mediaAssetId) =>
    requester.post(
      lookPath(lookId, '/canonical-frame'),
      SetCanonicalFrameBody.parse({ mediaAssetId }),
      WireLook,
    ),
})
