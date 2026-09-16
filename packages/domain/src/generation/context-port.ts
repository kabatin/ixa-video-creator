import type { MediaAssetId, ShotId } from '../common/ids.js'
import type { Location } from '../asset/library.js'
import type { ShotReference } from '../shot/reference.js'
import type { CharacterBundle } from './reference-resolver.js'

/**
 * 生成に必要な参照情報を読み出す Port。
 *
 * Character / Look / Location のリポジトリは **Phase 2 で実装する**。
 * Phase 1 の縦串ではキャラクターを扱わないため、空を返す実装で通す。
 * Port を先に切っておくことで、Phase 2 で実装を差し替えるだけで済む。
 */
export interface GenerationContextSource {
  /** Shot に紐づく登場人物と、解決済みの Look・参照画像を返す。 */
  charactersForShot(shotId: ShotId): Promise<readonly CharacterBundle[]>
  /** Shot に紐づくロケーションを返す。 */
  locationsForShot(shotId: ShotId): Promise<readonly Location[]>
  /** 手動で追加された参照を返す。 */
  manualReferencesForShot(shotId: ShotId): Promise<readonly ShotReference[]>
  /** 連続性のために使う、前 Shot の最終フレーム。無ければ null。 */
  previousShotLastFrame(shotId: ShotId): Promise<MediaAssetId | null>
  /** ai_image_to_video のキーフレーム。無ければ null。 */
  startFrame(shotId: ShotId): Promise<MediaAssetId | null>
}

/**
 * Phase 1 用の空実装。
 * キャラクターもロケーションも参照も持たない Shot として扱う。
 * **Phase 2 で必ず差し替えること。** 差し替え忘れを防ぐため名前に phase1 を含めている。
 */
export const createPhase1EmptyContextSource = (): GenerationContextSource => ({
  charactersForShot: () => Promise.resolve([]),
  locationsForShot: () => Promise.resolve([]),
  manualReferencesForShot: () => Promise.resolve([]),
  previousShotLastFrame: () => Promise.resolve(null),
  startFrame: () => Promise.resolve(null),
})
