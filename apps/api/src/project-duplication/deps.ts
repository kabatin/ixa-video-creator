import type {
  BrandAssetRepository,
  CharacterRepository,
  LocationRepository,
  NarrationLineRepository,
  NarrationTakeRepository,
  VoiceProfileRepository,
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
  /**
   * 声とナレーション（ADR-0038）。ナレーションを繋いでいない環境では省く。
   * 省いた環境で「声」を選んだときは、何も写さずに知らせる（黙って飛ばさない）。
   */
  readonly voices?: Pick<VoiceProfileRepository, 'findByProject' | 'create'>
  readonly narrationLines?: Pick<NarrationLineRepository, 'findByProject' | 'createMany' | 'update'>
  readonly narrationTakes?: Pick<NarrationTakeRepository, 'findByLines' | 'create'>
  readonly logger: Logger
}
