import {
  BrandAsset,
  Location,
  MediaAssetId,
  type BrandAssetId,
  type CharacterId,
  type LocationId,
  type MusicTrackId,
  type ProjectId,
  type VoiceProfileId,
} from '@ixa/domain'
import { z } from 'zod'
import { WireCharacterList } from '@/lib/character-schemas'
import { WireMusicTrackList } from '@/lib/music-api'
import { WireVoice } from '@/lib/narration-api'
import type { Requester } from '@/lib/requester'

/**
 * ほかのプロジェクトから取り込む（ADR-0034・ADR-0053。制作者 2026-10-03「全プロジェクトで共有になっている。
 * プロジェクト単位にしないと大変なことになる」）。`POST /projects/{projectId}/library-imports`。
 *
 * 素材ツリーの段はプロジェクトごとなので、別のプロジェクトで使うときは複製する。
 * 画像・音のファイルは同じものを指す。複製した後は別物。
 */

export type SfxSoundRef = { readonly sfxJobId: string; readonly mediaAssetId: MediaAssetId }

export type LibraryImportRequest = {
  readonly characterIds: readonly CharacterId[]
  readonly locationIds: readonly LocationId[]
  readonly brandAssetIds: readonly BrandAssetId[]
  readonly voiceIds: readonly VoiceProfileId[]
  readonly musicTrackIds: readonly MusicTrackId[]
  readonly sfxSounds: readonly SfxSoundRef[]
}

export const WireLibraryImportResult = z.object({
  characters: WireCharacterList,
  locations: z.array(Location),
  brandAssets: z.array(BrandAsset),
  voices: z.array(WireVoice),
  musicTracks: WireMusicTrackList,
  sfxSounds: z.array(z.object({ sfxJobId: z.string(), mediaAssetId: MediaAssetId })),
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
        voiceIds: [...request.voiceIds],
        musicTrackIds: [...request.musicTrackIds],
        sfxSounds: request.sfxSounds.map(({ sfxJobId, mediaAssetId }) => ({ sfxJobId, mediaAssetId })),
      },
      WireLibraryImportResult,
    ),
})
