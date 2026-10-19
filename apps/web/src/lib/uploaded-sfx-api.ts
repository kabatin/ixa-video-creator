import { MediaAssetId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 手元のファイルから取り込んだ効果音（ADR-0056）の口。作った効果音（sfx_jobs）とは別の記録。
 * 素材ツリーの効果音に、作った音と並べて出す。
 */

/** 画面で使う欄だけを読む。素材の ID の形でなければ読み込みごと失敗させる（黙って行を落とさない）。 */
export const WireUploadedSfx = z.object({
  id: z.string(),
  mediaAssetId: MediaAssetId,
  title: z.string(),
  createdAt: z.string(),
})
export type WireUploadedSfx = z.infer<typeof WireUploadedSfx>

const WireUploadedSfxList = z.array(WireUploadedSfx)

export type UploadedSfxApi = {
  /** 作品の取り込んだ効果音（新しい順）。 */
  listUploadedSfx: (projectId: ProjectId) => Promise<WireUploadedSfx[]>
  /** 上げた音の素材を、作品の効果音として記す（効果音の段には置かない）。 */
  uploadSfxSound: (
    projectId: ProjectId,
    input: { readonly mediaAssetId: string; readonly title: string },
  ) => Promise<WireUploadedSfx>
}

export const createUploadedSfxApi = (requester: Requester): UploadedSfxApi => ({
  listUploadedSfx: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/uploaded-sfx`, WireUploadedSfxList),
  uploadSfxSound: async (projectId, input) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/uploaded-sfx`,
      { mediaAssetId: input.mediaAssetId, title: input.title },
      WireUploadedSfx,
    ),
})
