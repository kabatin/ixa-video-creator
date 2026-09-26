import { MediaAssetId, type ShotId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Shot の最初のフレーム（ADR-0025）。画像を 1 枚付け、ローカルの画像→動画などで Take にする。
 * 中身は手動の参照 `start_frame` 1 件（付け直しは置き換え）。
 */

export const WireStartFrame = z.object({ mediaAssetId: MediaAssetId.nullable() })
export type WireStartFrame = z.infer<typeof WireStartFrame>

export type ShotStartFrameApi = {
  getStartFrame: (shotId: ShotId) => Promise<WireStartFrame>
  setStartFrame: (shotId: ShotId, mediaAssetId: MediaAssetId) => Promise<WireStartFrame>
  clearStartFrame: (shotId: ShotId) => Promise<void>
}

const path = (shotId: ShotId): string => `/shots/${encodeURIComponent(shotId)}/start-frame`

export const createShotStartFrameApi = (requester: Requester): ShotStartFrameApi => ({
  getStartFrame: async (shotId) => requester.get(path(shotId), WireStartFrame),
  setStartFrame: async (shotId, mediaAssetId) =>
    requester.put(path(shotId), { mediaAssetId }, WireStartFrame),
  clearStartFrame: async (shotId) => requester.remove(path(shotId)),
})
