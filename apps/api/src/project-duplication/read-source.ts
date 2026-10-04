import {
  MANUAL_ANALYZER_VERSION,
  isTelopClip,
  type BrandAsset,
  type Character,
  type DuplicationItem,
  type Location,
  type MusicAnalysis,
  type MusicTrack,
  type Project,
  type Sequence,
  type Shot,
  type ShotCharacter,
  type ShotReference,
  type Take,
  type TakeId,
  type TextStylePreset,
  type TimelineClip,
  type Transition,
} from '@ixa/domain'
import type { ProjectDuplicationDeps } from './deps.js'

/**
 * 複製の元を読む。**書く前に全部読む**（読みながら書くと、途中で失敗したとき何を写したか分からない）。
 * 選ばなかった項目は読まない。
 */

export type SourceTrack = {
  readonly track: MusicTrack
  /** 写す解析（古い順）。手で直した版があればそれと最新。作り直すと最新が変わらないよう古い順に作る。 */
  readonly analyses: readonly MusicAnalysis[]
}

export type SourceShot = {
  readonly shot: Shot
  readonly cast: readonly ShotCharacter[]
  /** 人が付けた参照（最初のフレーム）。生成のたびに組み立てる参照（derived）は写さない。 */
  readonly frames: readonly ShotReference[]
  /** 外した Take も含む（番号を元と同じにするため）。 */
  readonly takes: readonly Take[]
  readonly hiddenTakeIds: ReadonlySet<TakeId>
}

export type DuplicationSource = {
  readonly project: Project
  /** コンセプト・あらすじ（いまの版）。無ければ null。 */
  readonly concept: string | null
  readonly tracks: readonly SourceTrack[]
  readonly characters: readonly Character[]
  readonly locations: readonly Location[]
  readonly brandAssets: readonly BrandAsset[]
  readonly textStyles: readonly TextStylePreset[]
  readonly clips: readonly TimelineClip[]
  readonly sequences: readonly Sequence[]
  readonly shots: readonly SourceShot[]
  readonly transitions: readonly Transition[]
}

const none = <T>(): Promise<readonly T[]> => Promise.resolve([])

const readConcept = async (deps: ProjectDuplicationDeps, project: Project): Promise<string | null> => {
  const script = await deps.scripts.findByProject(project.id)
  if (script === null || script.currentVersionId === null) return null
  return (await deps.scripts.findVersionById(script.currentVersionId))?.content ?? null
}

const readTrack = async (deps: ProjectDuplicationDeps, track: MusicTrack): Promise<SourceTrack> => {
  const [latest, manual] = await Promise.all([
    deps.musicAnalyses.findByTrack(track.id),
    deps.musicAnalyses.findByTrackAndVersion(track.id, MANUAL_ANALYZER_VERSION),
  ])
  const analyses = [manual, latest]
    .filter((analysis): analysis is MusicAnalysis => analysis !== null)
    .filter((analysis, index, all) => all.findIndex((other) => other.id === analysis.id) === index)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  return { track, analyses }
}

const readShot = async (deps: ProjectDuplicationDeps, shot: Shot, items: ReadonlySet<DuplicationItem>): Promise<SourceShot> => {
  const [cast, references, allTakes, visibleTakes] = await Promise.all([
    deps.shotCharacters.findByShot(shot.id),
    items.has('frames') ? deps.shotReferences.findByShot(shot.id) : none<ShotReference>(),
    items.has('takes') ? deps.takes.findByShot(shot.id, { includeHidden: true }) : none<Take>(),
    items.has('takes') ? deps.takes.findByShot(shot.id) : none<Take>(),
  ])
  const visible = new Set(visibleTakes.map((take) => take.id))
  return {
    shot,
    cast,
    frames: references.filter((reference) => reference.sourceKind === 'manual'),
    takes: [...allTakes].sort((a, b) => a.index - b.index),
    hiddenTakeIds: new Set(allTakes.filter((take) => !visible.has(take.id)).map((take) => take.id)),
  }
}

/** テロップ・重ね素材のうち、選んだ方だけ。 */
const pickClips = (clips: readonly TimelineClip[], items: ReadonlySet<DuplicationItem>): readonly TimelineClip[] =>
  clips.filter((clip) => (isTelopClip(clip) ? items.has('telops') : items.has('overlays')))

export const readDuplicationSource = async (
  deps: ProjectDuplicationDeps,
  project: Project,
  items: ReadonlySet<DuplicationItem>,
): Promise<DuplicationSource> => {
  const [concept, tracks, characters, locations, brandAssets, textStyles, clips, sequences, shots, transitions] =
    await Promise.all([
      items.has('concept') ? readConcept(deps, project) : Promise.resolve(null),
      items.has('music') ? deps.musicTracks.findByProject(project.id) : none<MusicTrack>(),
      items.has('characters') ? deps.characters.findByProject(project.id) : none<Character>(),
      items.has('locations') ? deps.locations.findByProject(project.id) : none<Location>(),
      items.has('brandAssets') ? deps.brandAssets.findByProject(project.id) : none<BrandAsset>(),
      items.has('telops') ? deps.textStyles.findByProject(project.id) : none<TextStylePreset>(),
      items.has('telops') || items.has('overlays') ? deps.timelineClips.findByProject(project.id) : none<TimelineClip>(),
      items.has('shots') ? deps.sequences.findByProject(project.id) : none<Sequence>(),
      items.has('shots') ? deps.shots.findByProject(project.id) : none<Shot>(),
      items.has('shots') ? deps.transitions.findByProject(project.id) : none<Transition>(),
    ])
  return {
    project,
    concept,
    tracks: await Promise.all(tracks.map((track) => readTrack(deps, track))),
    characters,
    locations,
    brandAssets,
    textStyles,
    clips: pickClips(clips, items),
    sequences,
    shots: await Promise.all(shots.map((shot) => readShot(deps, shot, items))),
    transitions,
  }
}
