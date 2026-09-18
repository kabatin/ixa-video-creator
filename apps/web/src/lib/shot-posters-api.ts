import { ShotId, TakeId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Shot ごとのサムネイルをまとめて取ってくる呼び出し口（P60-3）。
 *
 * 一覧 27 行に対して 27 回 URL を発行させない。**1 プロジェクト 1 往復**にする。
 * 返る URL は署名付きなので **state の外へ出さない**（規約 7。`localStorage` にも入れない）。
 * 期限は API 側の既定（300 秒）。切れたら `<img>` の `onError` で「読み込めません」に切り替わる。
 */

/**
 * 1 Shot 分。
 *
 * **`thumbnailUrl` と `reason` はどちらか一方だけが `null`。**
 * 絵が無いのに理由も無い、という形を型と検証の両方で禁じる。
 * 理由の無い空枠は「見ていない」と「無い」の区別を静かに消す（L-015）。
 */
export const WireShotPoster = z
  .object({
    shotId: ShotId,
    takeId: TakeId.nullable(),
    thumbnailUrl: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .refine((entry) => (entry.thumbnailUrl === null) !== (entry.reason === null), {
    message: 'thumbnailUrl と reason はどちらか一方だけが null であること（理由の無い空枠を作らない）',
  })
export type WireShotPoster = z.infer<typeof WireShotPoster>

export const WireShotPosterList = z.array(WireShotPoster)

export type ShotPostersApi = {
  /** プロジェクト内の Shot 全件分のサムネイル。並びは API が返した順（= Shot の並び）を保つ。 */
  listShotPosters: (projectId: ProjectId) => Promise<WireShotPoster[]>
}

export const createShotPostersApi = (requester: Requester): ShotPostersApi => ({
  listShotPosters: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/shot-posters`, WireShotPosterList),
})
