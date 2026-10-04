import {
  ImageGenerationJobId,
  ImageGenerationJobStatus,
  MediaAssetId,
  type ProjectId,
  type ShotId,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Shot の最初のフレーム（ADR-0025）。画像を 1 枚付け、ローカルの画像→動画などで Take にする。
 * 中身は手動の参照 `start_frame` 1 件（付け直しは置き換え）。
 * 絵コンテの画像を AI で作る口もここ（ADR-0029。作るのは worker、1 枚 1 分ほど）。
 */

export const WireStartFrame = z.object({ mediaAssetId: MediaAssetId.nullable() })
export type WireStartFrame = z.infer<typeof WireStartFrame>

/** 付いている絵と、絵コンテの画像を作った直近のジョブ。開き直しても「作っています」「作れませんでした」が分かる。 */
export const WireStartFrameState = WireStartFrame.extend({
  job: z
    .object({ id: ImageGenerationJobId, status: ImageGenerationJobStatus, error: z.string().nullable() })
    .nullable(),
})
export type WireStartFrameState = z.infer<typeof WireStartFrameState>

export const WireStartFrameGenerated = z.object({ jobId: ImageGenerationJobId })

export const WireStartFramesGenerated = z.object({
  jobIds: z.array(ImageGenerationJobId),
  /** 飛ばした数。作っている Shot と、絵がもうある Shot（既定）。 */
  skipped: z.object({ drawing: z.number().int(), hasFrame: z.number().int() }),
})
export type WireStartFramesGenerated = z.infer<typeof WireStartFramesGenerated>

export const WireImagesCancelled = z.object({ cancelledJobIds: z.array(ImageGenerationJobId) })
export type WireImagesCancelled = z.infer<typeof WireImagesCancelled>

export type ShotStartFrameApi = {
  getStartFrame: (shotId: ShotId) => Promise<WireStartFrameState>
  setStartFrame: (shotId: ShotId, mediaAssetId: MediaAssetId) => Promise<WireStartFrame>
  clearStartFrame: (shotId: ShotId) => Promise<void>
  /** 絵コンテの画像を AI で作る（作っている間に押すと断られる）。 */
  generateStartFrame: (shotId: ShotId) => Promise<z.infer<typeof WireStartFrameGenerated>>
  /** まとめて作る。既定は絵の無い Shot だけ。 */
  generateStartFrames: (
    projectId: ProjectId,
    input: { readonly shotIds: readonly ShotId[]; readonly onlyMissing?: boolean },
  ) => Promise<WireStartFramesGenerated>
  /**
   * 待っている・作っている絵を止める（制作者 2026-10-04）。`shotIds` を渡せばその Shot だけ、
   * 渡さなければ作品の全部（キャラクターシートも）。
   */
  cancelImages: (projectId: ProjectId, shotIds?: readonly ShotId[]) => Promise<WireImagesCancelled>
}

const path = (shotId: ShotId): string => `/shots/${encodeURIComponent(shotId)}/start-frame`

export const createShotStartFrameApi = (requester: Requester): ShotStartFrameApi => ({
  getStartFrame: async (shotId) => requester.get(path(shotId), WireStartFrameState),
  setStartFrame: async (shotId, mediaAssetId) =>
    requester.put(path(shotId), { mediaAssetId }, WireStartFrame),
  clearStartFrame: async (shotId) => requester.remove(path(shotId)),
  generateStartFrame: async (shotId) => requester.post(`${path(shotId)}/generate`, {}, WireStartFrameGenerated),
  generateStartFrames: async (projectId, input) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/start-frames/generate`,
      { shotIds: [...input.shotIds], onlyMissing: input.onlyMissing ?? true },
      WireStartFramesGenerated,
    ),
  cancelImages: async (projectId, shotIds) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/images/cancel`,
      shotIds === undefined ? {} : { shotIds: [...shotIds] },
      WireImagesCancelled,
    ),
})
