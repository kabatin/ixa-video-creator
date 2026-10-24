import { MediaAssetId, ShotTiming, type ShotId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Shot の終わりの画像。付けた画像が、作る動画の最後のコマになる（例: 最後の Shot を最初の Shot の絵で終えてループにする）。
 * 中身は手動の参照 `end_frame` 1 件（付け直しは置き換え）。AI で作る口は無い。
 *
 * 付けるとサーバが Shot の時間の合わせ方を「Take を尺に合わせる」（`fit`）に替える。
 * Take を最後まで流さないと、最後のコマが Shot の終わりに来ないため。外しても合わせ方は戻さない。
 */

export const WireEndFrame = z.object({ mediaAssetId: MediaAssetId.nullable() })
export type WireEndFrame = z.infer<typeof WireEndFrame>

export const WireEndFrameSaved = z.object({ mediaAssetId: MediaAssetId, timing: ShotTiming })
export type WireEndFrameSaved = z.infer<typeof WireEndFrameSaved>

export type ShotEndFrameApi = {
  getEndFrame: (shotId: ShotId) => Promise<WireEndFrame>
  setEndFrame: (shotId: ShotId, mediaAssetId: MediaAssetId) => Promise<WireEndFrameSaved>
  clearEndFrame: (shotId: ShotId) => Promise<void>
}

const path = (shotId: ShotId): string => `/shots/${encodeURIComponent(shotId)}/end-frame`

export const createShotEndFrameApi = (requester: Requester): ShotEndFrameApi => ({
  getEndFrame: async (shotId) => requester.get(path(shotId), WireEndFrame),
  setEndFrame: async (shotId, mediaAssetId) => requester.put(path(shotId), { mediaAssetId }, WireEndFrameSaved),
  clearEndFrame: async (shotId) => requester.remove(path(shotId)),
})
