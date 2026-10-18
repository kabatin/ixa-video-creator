import type {
  BrandAssetRepository,
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
  MusicAnalysisRepository,
  MusicTrackRepository,
} from '@ixa/db'
import {
  MANUAL_ANALYZER_VERSION,
  copyMusicAnalysisInput,
  importMusicTrackInput,
  type BrandAsset,
  type Character,
  type CharacterLookId,
  type Location,
  type MusicAnalysis,
  type MusicTrack,
  type Project,
} from '@ixa/domain'
import { sequentially } from './sequentially.js'

/**
 * キャラクター・ロケーション・ブランド資産を別のプロジェクトへ写す（ADR-0034）。
 * 「ほかのプロジェクトから取り込む」と「プロジェクトを複製」（制作者 2026-10-04）が同じ写し方を使う。
 *
 * - キャラクターは Look・同一性の画像・Look の画像・正面の絵ごと。画像のファイル（MediaAsset）は写さず同じものを指す
 * - 写す列は名前で並べる（行を丸ごと広げると、ID まで写す・列が増えたとき黙って写すことになる）
 * - 写した後は別物（片方を直しても、もう片方は変わらない）
 */

export type LibraryCopyDeps = {
  readonly characters: Pick<CharacterRepository, 'create' | 'listIdentityImages' | 'addIdentityImage'>
  readonly looks: Pick<CharacterLookRepository, 'findByCharacter' | 'create' | 'listLookImages' | 'addLookImage'>
  readonly locations: Pick<LocationRepository, 'create'>
  readonly brandAssets: Pick<BrandAssetRepository, 'create'>
}

type Target = Pick<Project, 'id' | 'workspaceId'>

/** 写したキャラクターと、元の Look から写した Look への付け替え表（Shot の登場人物を張り直すのに使う）。 */
export type CopiedCharacter = {
  readonly character: Character
  readonly looks: ReadonlyMap<CharacterLookId, CharacterLookId>
}

export const copyCharacter = async (
  deps: LibraryCopyDeps,
  source: Character,
  target: Target,
): Promise<CopiedCharacter> => {
  const copy = await deps.characters.create({
    workspaceId: target.workspaceId,
    projectId: target.id,
    name: source.name,
    displayName: source.displayName,
    description: source.description,
    identityAnchors: source.identityAnchors,
    styleTokens: source.styleTokens,
    colorPalette: source.colorPalette,
  })
  for (const image of await deps.characters.listIdentityImages(source.id)) {
    await deps.characters.addIdentityImage({
      characterId: copy.id,
      mediaAssetId: image.mediaAssetId,
      role: image.role,
      isPrimary: image.isPrimary,
      order: image.order,
    })
  }
  const looks = new Map<CharacterLookId, CharacterLookId>()
  // 1 件ずつ順に作る（Look の既定の付け替えは作る順に依存する）。
  for (const look of await deps.looks.findByCharacter(source.id)) {
    const copiedLook = await deps.looks.create({
      characterId: copy.id,
      key: look.key,
      name: look.name,
      era: look.era,
      description: look.description,
      wardrobeTokens: look.wardrobeTokens,
      styleTokens: look.styleTokens,
      colorPalette: look.colorPalette,
      isDefault: look.isDefault,
      canonicalFrameAssetId: look.canonicalFrameAssetId,
    })
    looks.set(look.id, copiedLook.id)
    for (const image of await deps.looks.listLookImages(look.id)) {
      await deps.looks.addLookImage({
        lookId: copiedLook.id,
        mediaAssetId: image.mediaAssetId,
        role: image.role,
        isPrimary: image.isPrimary,
        order: image.order,
      })
    }
  }
  return { character: copy, looks }
}

export const copyLocation = (deps: LibraryCopyDeps, source: Location, target: Target): Promise<Location> =>
  deps.locations.create({
    workspaceId: target.workspaceId,
    projectId: target.id,
    name: source.name,
    description: source.description,
    referenceAssetIds: source.referenceAssetIds,
  })

export const copyBrandAsset = (deps: LibraryCopyDeps, source: BrandAsset, target: Target): Promise<BrandAsset> =>
  deps.brandAssets.create({
    workspaceId: target.workspaceId,
    projectId: target.id,
    category: source.category,
    name: source.name,
    mediaAssetId: source.mediaAssetId,
    value: source.value,
    usageRule: source.usageRule,
  })

export type MusicCopyDeps = {
  readonly musicTracks: Pick<MusicTrackRepository, 'create'>
  readonly musicAnalyses: Pick<MusicAnalysisRepository, 'findByTrack' | 'findByTrackAndVersion' | 'create'>
}

/**
 * 曲の解析のうち写すもの: 手で直した解析と最新の解析（同じなら 1 つ）。古い順。
 * 「作品を複製」と同じ選び方（手で直した拍は常に優先されるので、最新だけ写すと手直しが消える）。
 */
export const analysesToCopy = async (deps: MusicCopyDeps, track: MusicTrack): Promise<readonly MusicAnalysis[]> => {
  const [latest, manual] = await Promise.all([
    deps.musicAnalyses.findByTrack(track.id),
    deps.musicAnalyses.findByTrackAndVersion(track.id, MANUAL_ANALYZER_VERSION),
  ])
  return [manual, latest]
    .filter((analysis): analysis is MusicAnalysis => analysis !== null)
    .filter((analysis, index, all) => all.findIndex((other) => other.id === analysis.id) === index)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** 楽曲を取り込む（ADR-0053）。同じ音を指し、解析も写す（解析し直さない）。取り込み先ではマスターにしない。 */
export const copyMusicTrack = async (
  deps: MusicCopyDeps,
  source: MusicTrack,
  target: Pick<Project, 'id'>,
): Promise<MusicTrack> => {
  const analyses = await analysesToCopy(deps, source)
  const copy = await deps.musicTracks.create(importMusicTrackInput(source, target.id))
  await sequentially(analyses, (analysis) => deps.musicAnalyses.create(copyMusicAnalysisInput(analysis, copy.id)))
  return copy
}
