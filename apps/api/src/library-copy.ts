import type {
  BrandAssetRepository,
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
} from '@ixa/db'
import type { BrandAsset, Character, CharacterLookId, Location, Project } from '@ixa/domain'

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
