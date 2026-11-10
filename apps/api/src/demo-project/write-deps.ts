import type { CharacterId, CharacterLookId } from '@ixa/domain'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import type { CharacterAssets } from './source-wire.js'

/**
 * 見本を書くときに複製の書き手へ渡す口（ADR-0067）。**書くのは本物のリポジトリ、元の作品を読む口は目録が答える。**
 *
 * 複製の書き手は、書く途中で元の作品を読むことがある（キャラクターの Look と画像）。見本には元の作品が無いので、
 * その読みは目録（`characterAssets`）が答える。**目録が答えない読みは、空を返さずに投げる**
 * （書き手が新しく元を読むようになったとき、黙って中身の少ない作品を入れないため）。
 *
 * いま書く途中で読むのは次の 4 つ（`library-copy.ts` の `copyCharacter` と `write-shots.ts`）:
 * - `characters.listIdentityImages`・`looks.findByCharacter`・`looks.listLookImages` → 目録が答える
 * - `motionAnalyses.findLatestSucceededByTakes` → 口ごと渡さない（省ける口。写した先で分析し直すだけ）
 */

/** 目録が答えない読み。呼ばれたら投げる。 */
const unserved =
  (name: string) =>
  (): Promise<never> =>
    Promise.reject(new Error(`見本を書く途中で、目録が答えない読み（${name}）が呼ばれました`))

/** 本物のリポジトリの書く口だけを、持ち主に結び付けたまま取り出す（`this` を使う実装があっても壊れない）。 */
const writersOf = <T extends object, K extends keyof T>(repo: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(
    keys.map((key) => {
      const value = repo[key]
      return [key, typeof value === 'function' ? value.bind(repo) : value]
    }),
  ) as Pick<T, K>

const assetsOf = (assets: readonly CharacterAssets[], characterId: CharacterId): CharacterAssets => {
  const found = assets.find((entry) => entry.characterId === characterId)
  if (found === undefined) throw new Error('見本の目録に、キャラクターの Look と画像がありません')
  return found
}

const lookImagesOf = (assets: readonly CharacterAssets[], lookId: CharacterLookId) => {
  const found = assets.flatMap((entry) => entry.looks).find((entry) => entry.look.id === lookId)
  if (found === undefined) throw new Error('見本の目録に、Look の画像がありません')
  return [...found.images]
}

export const demoWriteDeps = (
  real: ProjectDuplicationDeps,
  characterAssets: readonly CharacterAssets[],
): ProjectDuplicationDeps => {
  const { voices, narrationLines, narrationTakes } = real
  return {
    projects: { ...writersOf(real.projects, ['create', 'update', 'softDelete']), findById: unserved('projects.findById') },
    scripts: {
      ...writersOf(real.scripts, ['ensureForProject', 'appendVersion']),
      findByProject: unserved('scripts.findByProject'),
      findVersionById: unserved('scripts.findVersionById'),
    },
    musicTracks: { ...writersOf(real.musicTracks, ['create']), findByProject: unserved('musicTracks.findByProject') },
    musicAnalyses: {
      ...writersOf(real.musicAnalyses, ['create']),
      findByTrack: unserved('musicAnalyses.findByTrack'),
      findByTrackAndVersion: unserved('musicAnalyses.findByTrackAndVersion'),
    },
    characters: {
      ...writersOf(real.characters, ['create', 'addIdentityImage']),
      findByProject: unserved('characters.findByProject'),
      listIdentityImages: (characterId) => Promise.resolve([...assetsOf(characterAssets, characterId).identityImages]),
    },
    looks: {
      ...writersOf(real.looks, ['create', 'addLookImage']),
      findByCharacter: (characterId) => Promise.resolve(assetsOf(characterAssets, characterId).looks.map((entry) => entry.look)),
      listLookImages: (lookId) => Promise.resolve(lookImagesOf(characterAssets, lookId)),
    },
    locations: { ...writersOf(real.locations, ['create']), findByProject: unserved('locations.findByProject') },
    brandAssets: { ...writersOf(real.brandAssets, ['create']), findByProject: unserved('brandAssets.findByProject') },
    textStyles: { ...writersOf(real.textStyles, ['create']), findByProject: unserved('textStyles.findByProject') },
    timelineClips: { ...writersOf(real.timelineClips, ['replace']), findByProject: unserved('timelineClips.findByProject') },
    sequences: { ...writersOf(real.sequences, ['create']), findByProject: unserved('sequences.findByProject') },
    shots: { ...writersOf(real.shots, ['createMany', 'update', 'selectTake']), findByProject: unserved('shots.findByProject') },
    shotCharacters: { ...writersOf(real.shotCharacters, ['replaceAll']), findByShot: unserved('shotCharacters.findByShot') },
    shotReferences: { ...writersOf(real.shotReferences, ['create']), findByShot: unserved('shotReferences.findByShot') },
    takes: { ...writersOf(real.takes, ['create', 'updateReview', 'hide']), findByShot: unserved('takes.findByShot') },
    transitions: { ...writersOf(real.transitions, ['create']), findByProject: unserved('transitions.findByProject') },
    ...(voices === undefined
      ? {}
      : { voices: { ...writersOf(voices, ['create']), findByProject: unserved('voices.findByProject') } }),
    ...(narrationLines === undefined
      ? {}
      : {
          narrationLines: {
            ...writersOf(narrationLines, ['createMany', 'update']),
            findByProject: unserved('narrationLines.findByProject'),
          },
        }),
    ...(narrationTakes === undefined
      ? {}
      : { narrationTakes: { ...writersOf(narrationTakes, ['create']), findByLines: unserved('narrationTakes.findByLines') } }),
    // 動きの分析（motionAnalyses）は渡さない（上の注記）。
    syncDialogueTelops: real.syncDialogueTelops,
    logger: real.logger,
  }
}
