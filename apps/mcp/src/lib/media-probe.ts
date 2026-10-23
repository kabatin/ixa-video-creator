import { z } from 'zod'
import { seg, type ApiClient } from '../api-client.js'
import type { Clock } from '../tool-def.js'

/**
 * 上げた音の長さを待つ。長さ（probe）は取り込みジョブが後から測るので、上げた直後はまだ無い。
 * 段に置く（効果音）・録音を取り込む（ナレーション）は長さが要るため、少しだけ待つ。
 */

const WireProbed = z.object({ probe: z.object({ durationSec: z.number().nullable() }).nullable() })

/** 待つ上限（秒）。短い音の取り込みは数秒で終わる。 */
export const PROBE_WAIT_SEC = 60
const PROBE_POLL_MS = 1_000

/** 測れた長さ（秒）。上限までに測れなければ null。 */
export const waitForDuration = async (
  api: ApiClient,
  clock: Clock,
  mediaAssetId: string,
  maxWaitSec: number = PROBE_WAIT_SEC,
): Promise<number | null> => {
  const deadline = clock.now() + maxWaitSec * 1_000
  for (;;) {
    const asset = await api.get(`/media/${seg(mediaAssetId)}`, WireProbed)
    const durationSec = asset.probe?.durationSec ?? null
    if (durationSec !== null && durationSec > 0) return durationSec
    if (clock.now() >= deadline) return null
    await clock.sleep(PROBE_POLL_MS)
  }
}
