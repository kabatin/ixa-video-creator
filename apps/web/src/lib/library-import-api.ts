import { BrandAsset, Location, type BrandAssetId, type CharacterId, type LocationId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import { WireCharacterList } from '@/lib/character-schemas'
import type { Requester } from '@/lib/requester'

/**
 * ほかのプロジェクトから取り込む（ADR-0034。制作者 2026-10-03「全プロジェクトで共有になっている。プロジェクト単位に
 * しないと大変なことになる」）。`POST /projects/{projectId}/library-imports`。
 *
 * キャラクター・ロケーション・ブランド資産はプロジェクトごとなので、別のプロジェクトで使うときは複製する。
 * キャラクターは Look・画像ごと（画像のファイルは同じものを指す）。複製した後は別物。
 */

export type LibraryImportRequest = {
  readonly characterIds: readonly CharacterId[]
  readonly locationIds: readonly LocationId[]
  readonly brandAssetIds: readonly BrandAssetId[]
}

export const WireLibraryImportResult = z.object({
  characters: WireCharacterList,
  locations: z.array(Location),
  brandAssets: z.array(BrandAsset),
})
export type WireLibraryImportResult = z.infer<typeof WireLibraryImportResult>

export type LibraryImportApi = {
  readonly importLibrary: (projectId: ProjectId, request: LibraryImportRequest) => Promise<WireLibraryImportResult>
}

export const createLibraryImportApi = (requester: Requester): LibraryImportApi => ({
  importLibrary: async (projectId, request) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/library-imports`,
      {
        characterIds: [...request.characterIds],
        locationIds: [...request.locationIds],
        brandAssetIds: [...request.brandAssetIds],
      },
      WireLibraryImportResult,
    ),
})
