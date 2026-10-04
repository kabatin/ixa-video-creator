import type {
  BrandAssetRepository,
  CharacterRepository,
  LocationRepository,
  MusicAnalysisRepository,
  MusicTrackRepository,
  ProjectRepository,
  ScriptRepository,
  SequenceRepository,
  ShotCharacterRepository,
  ShotReferenceRepository,
  ShotRepository,
  TakeRepository,
  TextStyleRepository,
  TimelineClipRepository,
  TransitionRepository,
} from '@ixa/db'
import type { Logger } from 'pino'
import type { LibraryCopyDeps } from '../library-copy.js'

/**
 * 作品の複製（制作者 2026-10-04）が読む・書くリポジトリ。**既存の口だけで足りる**（新しい口は作らない）。
 * 読むのは元の作品、書くのは新しい作品。元の作品には書かない。
 */
export type ProjectDuplicationDeps = LibraryCopyDeps & {
  readonly projects: Pick<ProjectRepository, 'findById' | 'create' | 'update' | 'softDelete'>
  readonly scripts: Pick<ScriptRepository, 'findByProject' | 'findVersionById' | 'ensureForProject' | 'appendVersion'>
  readonly musicTracks: Pick<MusicTrackRepository, 'findByProject' | 'create'>
  readonly musicAnalyses: Pick<MusicAnalysisRepository, 'findByTrack' | 'findByTrackAndVersion' | 'create'>
  readonly characters: LibraryCopyDeps['characters'] & Pick<CharacterRepository, 'findByProject'>
  readonly locations: LibraryCopyDeps['locations'] & Pick<LocationRepository, 'findByProject'>
  readonly brandAssets: LibraryCopyDeps['brandAssets'] & Pick<BrandAssetRepository, 'findByProject'>
  readonly textStyles: Pick<TextStyleRepository, 'findByProject' | 'create'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'replace'>
  readonly sequences: Pick<SequenceRepository, 'findByProject' | 'create'>
  readonly shots: Pick<ShotRepository, 'findByProject' | 'createMany' | 'update' | 'selectTake'>
  readonly shotCharacters: Pick<ShotCharacterRepository, 'findByShot' | 'replaceAll'>
  readonly shotReferences: Pick<ShotReferenceRepository, 'findByShot' | 'create'>
  readonly takes: Pick<TakeRepository, 'findByShot' | 'create' | 'updateReview' | 'hide'>
  readonly transitions: Pick<TransitionRepository, 'findByProject' | 'create'>
  readonly logger: Logger
}
