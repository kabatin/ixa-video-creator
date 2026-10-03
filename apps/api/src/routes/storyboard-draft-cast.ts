import type {
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
  ShotCharacterRepository,
} from '@ixa/db'
import type { ProjectId, Shot, ShotId } from '@ixa/domain'
import type { StoryboardDraftCharacter, StoryboardDraftLocation } from '@ixa/provider-llm'

/**
 * 絵コンテの下書きに渡す登場人物とロケーション（制作者 2026-10-04「絵コンテをAIに考えさせる時に、キャラクターの情報とかが
 * 入ってないのか、登場人物の指示が全然違う見た目を指示しているように感じる」）。
 *
 * 以前は 1 人も渡しておらず、画像だけで登録した人物に設定に無い髪の色や服装を書いていた。
 * **見た目は参照画像が決める**ので、ここでは文字で書かれていることだけを集める（画像は渡さない）。
 */

export type StoryboardDraftCastDeps = {
  characters: Pick<CharacterRepository, 'findByProject'>
  looks: Pick<CharacterLookRepository, 'findByCharacter'>
  locations: Pick<LocationRepository, 'findByProject'>
  shotCharacters: Pick<ShotCharacterRepository, 'findByShot'>
}

/** Shot 1 件に出る登場人物の名前と、ロケーションの名前。 */
export type StoryboardDraftShotCast = {
  readonly cast: readonly string[]
  readonly location: string | null
}

export type StoryboardDraftCast = {
  readonly characters: readonly StoryboardDraftCharacter[]
  readonly locations: readonly StoryboardDraftLocation[]
  readonly byShot: ReadonlyMap<ShotId, StoryboardDraftShotCast>
}

const NO_CAST: StoryboardDraftShotCast = { cast: [], location: null }

/** Shot の登場人物とロケーション。登録の無い Shot は空。 */
export const castOf = (cast: StoryboardDraftCast, shotId: ShotId): StoryboardDraftShotCast =>
  cast.byShot.get(shotId) ?? NO_CAST

/**
 * 作品の登場人物（Look 付き）・ロケーションと、Shot ごとの登場人物を読む。
 * 下書きは数分かかる呼び出しなので、Shot ごとに読んでも待ち時間はほぼ変わらない。
 */
export const loadStoryboardDraftCast = async (
  deps: StoryboardDraftCastDeps,
  projectId: ProjectId,
  shots: readonly Shot[],
): Promise<StoryboardDraftCast> => {
  const [characters, locations] = await Promise.all([
    deps.characters.findByProject(projectId),
    deps.locations.findByProject(projectId),
  ])
  const [looksByCharacter, entriesByShot] = await Promise.all([
    Promise.all(characters.map((character) => deps.looks.findByCharacter(character.id))),
    Promise.all(shots.map((shot) => deps.shotCharacters.findByShot(shot.id))),
  ])

  // 画面と同じ名前で指す（`name` は内部の呼び名で、画面には `displayName` が出る）。
  const characterName = new Map(characters.map((character) => [character.id, character.displayName] as const))
  const locationName = new Map(locations.map((location) => [location.id, location.name] as const))

  return {
    characters: characters.map((character, index) => ({
      name: character.displayName,
      description: character.description,
      identityAnchors: [...character.identityAnchors],
      looks: (looksByCharacter[index] ?? []).map((look) => ({
        name: look.name,
        description: look.description,
        wardrobeTokens: [...look.wardrobeTokens],
      })),
    })),
    locations: locations.map((location) => ({ name: location.name, description: location.description })),
    byShot: new Map(
      shots.map((shot, index) => [
        shot.id,
        {
          cast: (entriesByShot[index] ?? []).flatMap((entry) => {
            const name = characterName.get(entry.characterId)
            return name === undefined ? [] : [name]
          }),
          location: shot.locationId === null ? null : (locationName.get(shot.locationId) ?? null),
        },
      ]),
    ),
  }
}
