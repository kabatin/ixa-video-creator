import type { Character, CharacterIdentityImage, CharacterLook } from '@ixa/domain'
import { summarizeIdentityImages } from '@/lib/identity-images'

/** 一覧で 1 行に出す内容。四面図の有無は品質に直結するので必ず持つ。 */
export type CharacterSummary = {
  readonly character: Character
  readonly lookCount: number
  readonly defaultLookName: string | null
  readonly identityImageCount: number
  readonly hasFourView: boolean
}

export const toCharacterSummary = (
  character: Character,
  identityImages: readonly Pick<CharacterIdentityImage, 'role'>[],
  looks: readonly CharacterLook[],
): CharacterSummary => {
  const images = summarizeIdentityImages(identityImages)
  return {
    character,
    lookCount: looks.length,
    defaultLookName: looks.find((look) => look.isDefault)?.name ?? null,
    identityImageCount: images.total,
    hasFourView: images.hasFourView,
  }
}
