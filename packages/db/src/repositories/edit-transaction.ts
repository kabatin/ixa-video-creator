import type { DbExecutor } from '../client.js'
import { createBrandAssetRepository, type BrandAssetRepository } from './brand-asset-repository.js'
import { createCharacterLookRepository, type CharacterLookRepository } from './character-look-repository.js'
import { createCharacterRepository, type CharacterRepository } from './character-repository.js'
import { createLocationRepository, type LocationRepository } from './location-repository.js'
import { createVoiceProfileRepository, type VoiceProfileRepository } from './voice-profile-repository.js'
import { createEditBatchRepository, type EditBatchRepository } from './edit-batch-repository.js'
import { createMusicTrackRepository, type MusicTrackRepository } from './music-track-repository.js'
import { createNarrationLineRepository, type NarrationLineRepository } from './narration-line-repository.js'
import { createProjectRepository, type ProjectRepository } from './project-repository.js'
import { createShotCharacterRepository, type ShotCharacterRepository } from './shot-character-repository.js'
import { createShotReferenceRepository, type ShotReferenceRepository } from './shot-reference-repository.js'
import { createShotRepository, type ShotRepository } from './shot-repository.js'
import { createTimelineClipRepository, type TimelineClipRepository } from './timeline-clip-repository.js'
import { createTransitionRepository, type TransitionRepository } from './transition-repository.js'

/**
 * 取り消しの記録と、その記録が戻す書き込みを**同じトランザクション**で行う口（2026-10-19）。
 *
 * 記録を作ってから書き込みが落ちる（一意制約・途中で消された・INSERT 失敗）と、記録だけが残り、
 * ⌘Z が何も戻さない記録を拾って、本当に戻したい 1 つ前が戻らなくなる。逆に書き込みだけが残ると戻せない。
 * どちらも起こさないよう、1 つのトランザクションに閉じる。`fn` が投げれば両方とも無かったことになる。
 */
export type EditRepositories = {
  readonly editBatches: Pick<EditBatchRepository, 'create'>
  readonly projects: ProjectRepository
  readonly timelineClips: TimelineClipRepository
  readonly transitions: TransitionRepository
  readonly shots: ShotRepository
  readonly shotCharacters: ShotCharacterRepository
  readonly shotReferences: ShotReferenceRepository
  readonly musicTracks: MusicTrackRepository
  readonly narrationLines: NarrationLineRepository
  readonly characters: CharacterRepository
  readonly looks: CharacterLookRepository
  readonly locations: LocationRepository
  readonly brandAssets: BrandAssetRepository
  readonly voices: VoiceProfileRepository
}

export type EditTransaction = <T>(fn: (repos: EditRepositories) => Promise<T>) => Promise<T>

/** 接続でも、外側のトランザクションでも作れる（外側の中なら入れ子の SAVEPOINT になる。結合テストはこれで後片付けする）。 */
export const createEditTransaction =
  (db: DbExecutor): EditTransaction =>
  (fn) =>
    db.transaction((tx) =>
      fn({
        editBatches: createEditBatchRepository(tx),
        projects: createProjectRepository(tx),
        timelineClips: createTimelineClipRepository(tx),
        transitions: createTransitionRepository(tx),
        shots: createShotRepository(tx),
        shotCharacters: createShotCharacterRepository(tx),
        shotReferences: createShotReferenceRepository(tx),
        musicTracks: createMusicTrackRepository(tx),
        narrationLines: createNarrationLineRepository(tx),
        characters: createCharacterRepository(tx),
        looks: createCharacterLookRepository(tx),
        locations: createLocationRepository(tx),
        brandAssets: createBrandAssetRepository(tx),
        voices: createVoiceProfileRepository(tx),
      }),
    )
