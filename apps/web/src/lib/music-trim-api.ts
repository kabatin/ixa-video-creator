import { EditBatchId, MusicTrack, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 曲を最後の Shot で切る（制作者 2026-10-19「カットより長い部分は楽曲をカットするとか？」）。
 * 尻の黒画面の警告から押す。サーバが変える前を記録するので「元に戻す」で戻せる。
 */
export const WireTrimMusicResult = z.object({
  track: MusicTrack,
  /** 何も変わらなかったときは null（記録を作らない）。 */
  editBatchId: EditBatchId.nullable(),
})
export type WireTrimMusicResult = z.infer<typeof WireTrimMusicResult>

export type MusicTrimApi = {
  readonly trimMusicToShots: (projectId: ProjectId) => Promise<WireTrimMusicResult>
}

export const createMusicTrimApi = (requester: Requester): MusicTrimApi => ({
  trimMusicToShots: async (projectId) =>
    requester.post(`/projects/${encodeURIComponent(projectId)}/music-tracks/trim-to-shots`, undefined, WireTrimMusicResult),
})
