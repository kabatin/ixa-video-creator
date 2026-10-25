import { MusicTrackId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 楽曲を作ったときの頼み方（プロンプトビューア。制作者 2026-10-25）。
 * 楽曲の一覧（`GET /projects/{id}/music-tracks`）が各曲に添える `source` だけを読む。
 * 楽曲そのものの読み書きは `music-api.ts`（素材の一覧は頼み方を持たない形のまま）。
 */

export const WireMusicTrackSource = z.object({
  prompt: z.string(),
  lyrics: z.string(),
  instrumental: z.boolean(),
  seed: z.number().int().nullable(),
  durationSec: z.number(),
  tool: z.string(),
  model: z.string().nullable(),
  createdAt: z.coerce.date(),
})
export type WireMusicTrackSource = z.infer<typeof WireMusicTrackSource>

const WireTrackSources = z.array(
  z.object({ id: MusicTrackId, source: WireMusicTrackSource.nullable().optional() }),
)

export type MusicSourceApi = {
  /** AI で作った曲の頼み方。持ち込んだ曲は入らない。 */
  listMusicTrackSources: (projectId: ProjectId) => Promise<ReadonlyMap<MusicTrackId, WireMusicTrackSource>>
}

export const createMusicSourceApi = (requester: Requester): MusicSourceApi => ({
  listMusicTrackSources: async (projectId) => {
    const tracks = await requester.get(`/projects/${encodeURIComponent(projectId)}/music-tracks`, WireTrackSources)
    return new Map(
      tracks.flatMap((track) => (track.source === undefined || track.source === null ? [] : [[track.id, track.source] as const])),
    )
  },
})
