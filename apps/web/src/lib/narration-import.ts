import type { MediaAssetId } from '@ixa/domain'
import { ApiError } from '@/lib/api-error'
import type { RecordingImportBody } from '@/lib/narration-api'

/** API が「音の長さをまだ測っています」と返したか（上げた直後。少し待てば通る）。 */
const stillMeasuring = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409 && error.body.includes('音の長さをまだ測っています')

/**
 * 録音を取り込む頼みを、音の長さを測り終わるまで待って頼み直す（ADR-0038）。
 * ほかの失敗はすぐ返す（文字起こしの AI が無い・予算は、待っても直らない）。
 */
export const retryWhileMeasuring = async <T>(
  run: () => Promise<T>,
  options: { readonly sleep: (ms: number) => Promise<void>; readonly attempts: number; readonly intervalMs?: number },
): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      if (!stillMeasuring(error) || attempt >= options.attempts) throw error
      await options.sleep(options.intervalMs ?? 1000)
    }
  }
}

/** 録音を取り込む頼み。既定はノイズ除去をする（マイクの録音）。加工済み・合成の音は外す（声がこもるため）。 */
export const recordingImportBody = (input: {
  readonly mediaAssetId: MediaAssetId
  readonly atSec: number
  readonly skipDenoise: boolean
}): RecordingImportBody => ({
  mediaAssetId: input.mediaAssetId,
  voiceProfileId: null,
  placeAtSec: input.atSec,
  denoise: !input.skipDenoise,
})
