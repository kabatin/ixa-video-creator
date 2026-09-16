import type {
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
  MediaAssetRepository,
  ShotCharacterRepository,
  ShotReferenceRepository,
  ShotRepository,
  TakeRepository,
} from '@ixa/db'
import type {
  CharacterBundle,
  GenerationContextSource,
  Location,
  MediaAssetId,
  Shot,
  ShotCharacter,
  ShotId,
  ShotReference,
} from '@ixa/domain'

/**
 * `GenerationContextSource` の実実装（ARCHITECTURE.md §8）。
 *
 * ここは **読み出しと組み立てだけ**を行う。何を捨てて何を残すかの判断は
 * `resolveReferences`（packages/domain）の責務で、この層では一切決めない。
 * SQL は packages/db に閉じているため、本ファイルはリポジトリの呼び出しに徹する。
 */

export type GenerationContextDeps = {
  readonly shotCharacters: ShotCharacterRepository
  readonly characters: CharacterRepository
  readonly looks: CharacterLookRepository
  readonly locations: LocationRepository
  readonly shotReferences: ShotReferenceRepository
  readonly shots: ShotRepository
  readonly takes: TakeRepository
  readonly mediaAssets: MediaAssetRepository
}

/**
 * Shot が実在しない Character / Look を指している、という壊れたデータを表す。
 *
 * **黙って読み飛ばさない。** 参照を 1 つ落とすと人物一貫性が静かに劣化し、
 * 出来上がった動画を見るまで誰も気づけないため、生成を止めて知らせる。
 */
export class GenerationContextError extends Error {
  override readonly name = 'GenerationContextError'
}

/**
 * 参照枠の切り詰めで主役が先に残るよう、prominence の強い順に並べる。
 * `resolveReferences` は渡された順を保って候補を積むため、ここでの並びが結果を決める。
 */
const PROMINENCE_RANK: Readonly<Record<ShotCharacter['prominence'], number>> = Object.freeze({
  primary: 0,
  secondary: 1,
  background: 2,
})

const byProminenceThenOrder = (a: ShotCharacter, b: ShotCharacter): number =>
  PROMINENCE_RANK[a.prominence] - PROMINENCE_RANK[b.prominence] || a.order - b.order

export const createGenerationContextSource = (
  deps: GenerationContextDeps,
): GenerationContextSource => {
  /**
   * 1 件の紐づけを CharacterBundle へ解決する。
   * 4 回のリポジトリ呼び出しは互いに独立なので必ず並列で投げる。
   */
  const toBundle = async (entry: ShotCharacter): Promise<CharacterBundle> => {
    const [character, look, identityImages, lookImages] = await Promise.all([
      deps.characters.findById(entry.characterId),
      deps.looks.findById(entry.lookId),
      deps.characters.listIdentityImages(entry.characterId),
      deps.looks.listLookImages(entry.lookId),
    ])
    if (character === null) {
      throw new GenerationContextError(
        `Shot ${entry.shotId} が存在しない Character ${entry.characterId} を参照しています`,
      )
    }
    if (look === null) {
      throw new GenerationContextError(
        `Shot ${entry.shotId} が存在しない CharacterLook ${entry.lookId} を参照しています`,
      )
    }
    if (look.characterId !== entry.characterId) {
      throw new GenerationContextError(
        `CharacterLook ${entry.lookId} は Character ${entry.characterId} のものではありません`,
      )
    }
    return { character, look, identityImages, lookImages }
  }

  /** 前 Shot = 対象より小さい order のうち最大のもの。order は 1000 刻みで連番ではない。 */
  const previousShot = async (shot: Shot): Promise<Shot | null> => {
    const siblings = await deps.shots.findByProject(shot.projectId)
    const earlier = siblings
      .filter((candidate) => candidate.order < shot.order)
      .sort((a, b) => a.order - b.order)
    return earlier[earlier.length - 1] ?? null
  }

  return {
    async charactersForShot(shotId: ShotId): Promise<readonly CharacterBundle[]> {
      const entries = await deps.shotCharacters.findByShot(shotId)
      // 並べ替えを解決より先に行い、Promise.all が返す配列の順序をそのまま使う。
      const ordered = [...entries].sort(byProminenceThenOrder)
      /**
       * **N+1 を作らない。** 登場人物ごとに await すると人数分のラウンドトリップが
       * 直列に積み上がる。1 回の Promise.all にまとめることで、人数が増えても
       * 往復の段数は 2 段（紐づけ取得 → 全員分の解決）で一定に保つ。
       */
      return Promise.all(ordered.map(toBundle))
    },

    /**
     * ひと続きのカットは 1 つの場所で起きるため、返るのは 0 件か 1 件（ADR-0015）。
     * Port が配列を返すのは `resolveReferences` の入力に合わせているだけで、
     * 複数件を表現できることを意味しない。
     *
     * 実在しないロケーションを指していたら黙って落とさず例外にする。
     * 参照を 1 つ落とすと背景が静かに変わり、出来上がった動画を見るまで気づけない。
     */
    async locationsForShot(shotId: ShotId): Promise<readonly Location[]> {
      const shot = await deps.shots.findById(shotId)
      if (shot === null || shot.locationId === null) return []

      const location = await deps.locations.findById(shot.locationId)
      if (location === null) {
        throw new GenerationContextError(
          `Shot ${shotId} が存在しない Location ${shot.locationId} を参照しています`,
        )
      }
      return [location]
    },

    async manualReferencesForShot(shotId: ShotId): Promise<readonly ShotReference[]> {
      const references = await deps.shotReferences.findByShot(shotId)
      // derived_* は生成のたびに resolveReferences が作り直す。ここで混ぜると二重になる。
      return references
        .filter((reference) => reference.sourceKind === 'manual')
        .sort((a, b) => a.order - b.order)
    },

    /**
     * 連続性のために前 Shot の最終フレームを返す。
     *
     * **posterKeys ではなく MediaAsset.lastFrameAssetId を使う。** posterKeys は
     * ストレージキーの配列でレビュー表示用であり、参照として渡せない
     * （`ShotGenerationSpec.references` は MediaAssetId を要求する）。
     * media パイプラインが切り出した最終フレームは lastFrameAssetId に入る。
     */
    async previousShotLastFrame(shotId: ShotId): Promise<MediaAssetId | null> {
      const shot = await deps.shots.findById(shotId)
      if (shot === null) return null

      const previous = await previousShot(shot)
      // 採用 Take が決まっていない Shot の最終フレームは意味を持たない。
      if (previous === null || previous.selectedTakeId === null) return null

      const take = await deps.takes.findById(previous.selectedTakeId)
      if (take === null) return null

      const asset = await deps.mediaAssets.findById(take.mediaAssetId)
      return asset?.lastFrameAssetId ?? null
    },

    async startFrame(shotId: ShotId): Promise<MediaAssetId | null> {
      const shot = await deps.shots.findById(shotId)
      // キーフレーム方式は ai_image_to_video だけが持つ（DOMAIN.md §9 ShotSourceType）。
      if (shot === null || shot.sourceType.type !== 'ai_image_to_video') return null

      const keyframeTakeId = shot.sourceType.keyframeTakeId
      if (keyframeTakeId === null) return null

      const take = await deps.takes.findById(keyframeTakeId)
      return take?.mediaAssetId ?? null
    },
  }
}
