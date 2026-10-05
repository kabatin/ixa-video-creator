import {
  copyClipInput,
  copyNarrationLineInput,
  copyNarrationTakeInput,
  copyVoiceInput,
  type CharacterId,
  type CharacterLookId,
  type DuplicationItem,
  type LocationId,
  type NarrationLineId,
  type Project,
  type TextStyleId,
  type VoiceProfileId,
} from '@ixa/domain'
import { copyBrandAsset, copyCharacter, copyLocation } from '../library-copy.js'
import { sequentially } from '../sequentially.js'
import type { ProjectDuplicationDeps } from './deps.js'
import type { DuplicationSource } from './read-source.js'

/**
 * 新しい作品と、Shot 以外の中身（作品の方針・楽曲・キャラクターなど・テロップ）を書く。
 * 名前・画面の形・予算はいつも引き継ぐ。それ以外は選んだものだけ。
 */

/** Shot を張り直すのに使う付け替え表。 */
export type LibraryMaps = {
  readonly characters: ReadonlyMap<CharacterId, CharacterId>
  readonly looks: ReadonlyMap<CharacterLookId, CharacterLookId>
  readonly locations: ReadonlyMap<LocationId, LocationId>
}

/** 新しい作品を作る。作成の入力に無い項目（避けたいもの・歌詞など）は作った後に入れる。 */
export const createDuplicateProject = async (
  deps: ProjectDuplicationDeps,
  source: Project,
  name: string,
  items: ReadonlySet<DuplicationItem>,
): Promise<Project> => {
  const keepConcept = items.has('concept')
  const created = await deps.projects.create({
    workspaceId: source.workspaceId,
    name,
    fps: source.fps,
    resolution: source.resolution,
    aspectRatio: source.aspectRatio,
    budgetUsd: source.budgetUsd,
    styleGuide: keepConcept ? source.styleGuide : '',
  })
  return deps.projects.update(created.id, {
    ...(keepConcept
      ? {
          avoid: source.avoid,
          styleReferenceAssetIds: source.styleReferenceAssetIds,
          lyrics: source.lyrics,
          instrumental: source.instrumental,
        }
      : {}),
    // 尺は曲から決まる。曲を持っていくときだけ引き継ぐ。
    ...(items.has('music') ? { durationSec: source.durationSec } : {}),
    ...(items.has('lyricTiming') ? { lyricCues: source.lyricCues } : {}),
  })
}

/** コンセプト・あらすじ（いまの版だけ。版の履歴は持っていかない）。 */
export const writeConcept = async (deps: ProjectDuplicationDeps, target: Project, concept: string | null): Promise<void> => {
  if (concept === null) return
  const script = await deps.scripts.ensureForProject(target.id)
  await deps.scripts.appendVersion({ scriptId: script.id, content: concept, authoredBy: 'human' })
}

/** 楽曲と解析（セクションも）。ファイルは同じものを指す。解析し直さない。 */
export const writeMusic = async (deps: ProjectDuplicationDeps, target: Project, source: DuplicationSource): Promise<void> => {
  await sequentially(source.tracks, async ({ track, analyses }) => {
    const copied = await deps.musicTracks.create({
      projectId: target.id,
      mediaAssetId: track.mediaAssetId,
      title: track.title,
      isMaster: track.isMaster,
      offsetSec: track.offsetSec,
      volume: track.volume,
    })
    // 写す列は名前で並べる（行を丸ごと広げると、ID まで写す・列が増えたとき黙って写すことになる）。
    await sequentially(analyses, (analysis) =>
      deps.musicAnalyses.create({
        musicTrackId: copied.id,
        analyzerVersion: analysis.analyzerVersion,
        durationSec: analysis.durationSec,
        bpm: analysis.bpm,
        bpmConfidence: analysis.bpmConfidence,
        beats: analysis.beats,
        downbeats: analysis.downbeats,
        sections: analysis.sections,
        energyCurve: analysis.energyCurve,
        onsets: analysis.onsets,
        drops: analysis.drops,
        waveformPeaksKey: analysis.waveformPeaksKey,
      }),
    )
  })
}

/** キャラクター（Look・画像ごと）・ロケーション・ブランド資産。付け替え表を返す。 */
export const writeLibrary = async (
  deps: ProjectDuplicationDeps,
  target: Project,
  source: DuplicationSource,
): Promise<LibraryMaps> => {
  const characters = new Map<CharacterId, CharacterId>()
  const looks = new Map<CharacterLookId, CharacterLookId>()
  const locations = new Map<LocationId, LocationId>()
  // 1 件ずつ順に作る（Look の既定の付け替えは作る順に依存する）。
  await sequentially(source.characters, async (character) => {
    const copied = await copyCharacter(deps, character, target)
    characters.set(character.id, copied.character.id)
    for (const [from, to] of copied.looks) looks.set(from, to)
  })
  await sequentially(source.locations, async (location) => {
    locations.set(location.id, (await copyLocation(deps, location, target)).id)
  })
  await sequentially(source.brandAssets, (asset) => copyBrandAsset(deps, asset, target))
  return { characters, looks, locations }
}

/** 文字の見た目（保存したスタイル）。声とテロップの両方が指すので、どちらより先に写す。 */
export const writeTextStyles = async (
  deps: ProjectDuplicationDeps,
  target: Project,
  source: DuplicationSource,
): Promise<ReadonlyMap<TextStyleId, TextStyleId>> => {
  const styles = new Map<TextStyleId, TextStyleId>()
  await sequentially(source.textStyles, async (preset) => {
    styles.set(preset.id, (await deps.textStyles.create(target.id, { name: preset.name, style: preset.style })).id)
  })
  return styles
}

/**
 * 声とナレーション（ADR-0038）。声は写した人・見た目を指し直す。行は写した声を指し、声の Take は同じ音を指したまま
 * 「写したもの」になる（元の作品で作ったので作り直さない）。**声を持っていかなければ、どちらも写さない。**
 */
export const writeNarration = async (
  deps: ProjectDuplicationDeps,
  target: Project,
  source: DuplicationSource,
  items: ReadonlySet<DuplicationItem>,
  maps: { readonly characters: ReadonlyMap<CharacterId, CharacterId>; readonly styles: ReadonlyMap<TextStyleId, TextStyleId> },
): Promise<{
  readonly narrationLines: ReadonlyMap<NarrationLineId, NarrationLineId>
  readonly characterVoicesDropped: number
}> => {
  const voices = new Map<VoiceProfileId, VoiceProfileId>()
  if (items.has('voices')) {
    await sequentially(source.voices, async (voice) => {
      const copied = await deps.voices?.create(copyVoiceInput(voice, { projectId: target.id, ...maps }))
      if (copied !== undefined) voices.set(voice.id, copied.id)
    })
  }
  // 声を持っていかないとき、元でキャラクターに付いていた声は新しい作品に無い。何人分かを知らせる。
  const characterVoicesDropped = items.has('voices')
    ? 0
    : new Set(
        source.voices.flatMap((voice) =>
          voice.characterId !== null && maps.characters.has(voice.characterId) ? [voice.characterId] : [],
        ),
      ).size

  const narrationLines = new Map<NarrationLineId, NarrationLineId>()
  if (source.narrationLines.length > 0) {
    const created =
      (await deps.narrationLines?.createMany(
        source.narrationLines.map((line) => copyNarrationLineInput(line, { projectId: target.id, voices })),
      )) ?? []
    source.narrationLines.forEach((line, index) => {
      const copied = created[index]
      if (copied !== undefined) narrationLines.set(line.id, copied.id)
    })
    // Take は行ごとに番号が付くので、元と同じ順に作る。選んでいた Take は選び直す。
    const selected = new Map<NarrationLineId, NarrationLineId>()
    await sequentially(
      [...source.narrationTakes].sort((a, b) => a.index - b.index),
      async (take) => {
        if (!narrationLines.has(take.lineId)) return
        const copied = await deps.narrationTakes?.create(copyNarrationTakeInput(take, narrationLines))
        const line = source.narrationLines.find((candidate) => candidate.selectedTakeId === take.id)
        const movedLine = line === undefined ? undefined : narrationLines.get(line.id)
        if (copied !== undefined && movedLine !== undefined) {
          await deps.narrationLines?.update(movedLine, { selectedTakeId: copied.id })
          selected.set(movedLine, movedLine)
        }
      },
    )
  }
  return { narrationLines, characterVoicesDropped }
}

/** テロップと重ね素材。歌詞・ナレーションを持っていかなければ結び付きを外し、外した数を返す。 */
export const writeClips = async (
  deps: ProjectDuplicationDeps,
  target: Project,
  source: DuplicationSource,
  items: ReadonlySet<DuplicationItem>,
  maps: {
    readonly styles: ReadonlyMap<TextStyleId, TextStyleId>
    readonly narrationLines: ReadonlyMap<NarrationLineId, NarrationLineId>
  },
): Promise<{ readonly lyricLinksDropped: number; readonly narrationLinksDropped: number }> => {
  const copies = source.clips.map((clip) =>
    copyClipInput(clip, {
      projectId: target.id,
      styles: maps.styles,
      keepLyricLink: items.has('concept'),
      narrationLines: maps.narrationLines,
    }),
  )
  if (copies.length > 0) await deps.timelineClips.replace([], copies.map((copy) => copy.input))
  return {
    lyricLinksDropped: copies.filter((copy) => copy.lyricLinkDropped).length,
    narrationLinksDropped: copies.filter((copy) => copy.narrationLinkDropped).length,
  }
}
