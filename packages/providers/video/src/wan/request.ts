import type { Resolution, ShotGenerationSpec } from '@ixa/domain'
import { ensurePromptAndSeed, type LocalServerImage } from '../local-server/request.js'
import {
  WAN_IDENTITY,
  WAN_MAX_DURATION_SEC,
  WAN_MAX_SEED,
  WAN_MIN_DURATION_SEC,
  type WanQuality,
} from './descriptor.js'
import { localServerInputError } from '../local-server/request.js'

/**
 * Wan 2.2 TI2V-5B（wan-api の `wan2.2-ti2v-5b`）の投入の本文。
 * 共通の部分（プロンプトの上限・開始画像の形・参照の選び方）は `local-server/request.ts`。
 *
 * **モデル固有の都合を 1 つも入れない。** コマ数・サンプリングのステップ数・スケジューラ・量子化・
 * LoRA・生成解像度・重みのファイル名はすべて wan-api 側が段（`quality`）から決める。
 * そうしておけば「draft を 3 step から 4 step にする」「MLX の実装に替える」を ixa の変更なしでできる。
 */

/**
 * `POST /v1/workflows/wan2.2-ti2v-5b/jobs` の本文（wan-api の `docs/api.md` が正）。
 *
 * **ここに無いものを足すと 422 で断られる。** モデル名・ステップ数・サンプラー・LoRA・
 * ファイルのパスはサーバが拒否する契約になっている（PF に漏らさないことが型でも守られる）。
 */
export type WanJobBody = {
  readonly prompt: string
  /** 最終の大きさ。サーバが作れる大きさで作って、ここへ cover + 中央切り抜きで合わせる。 */
  readonly output: Resolution
  /**
   * 頼む尺（秒・float）。**コマ数は送らない。**
   * サーバは `floor(秒 × 24 + 0.5)` コマ（24fps）ちょうどに揃えて返す。
   */
  readonly duration_seconds: number
  /** 生成の段。サーバがこれを実行設定へ訳す。 */
  readonly quality: WanQuality
  readonly seed: number | null
  readonly start_image: LocalServerImage | null
}

export type BuildWanBody = {
  readonly spec: ShotGenerationSpec
  readonly quality: WanQuality
  /** 切り上げ済みの生成尺（秒）。`quantizeDuration` を通した値。 */
  readonly durationSec: number
  readonly startImage: LocalServerImage | null
}

/**
 * 仕様から本文を組む。**画像の取得はしない**（純関数。取得は `fetchStartImage`）。
 *
 * 秒は**丸めずに**そのまま送る。小数 3 桁へ丸めると、`round(秒 × 24)` がコマ 1 つ分ずれることがあり、
 * 実測尺と生成尺の差が technical レビューの許容（±0.05 秒）に近づく。
 */
export const buildWanBody = (input: BuildWanBody): WanJobBody => {
  const { spec, quality, durationSec, startImage } = input
  ensurePromptAndSeed(WAN_IDENTITY, spec)
  if (
    !Number.isFinite(durationSec) ||
    durationSec < WAN_MIN_DURATION_SEC ||
    durationSec > WAN_MAX_DURATION_SEC
  ) {
    // 宣言した範囲の外は、サーバへ送る前に落とす（422 を待たない）。
    throw localServerInputError(
      WAN_IDENTITY,
      `尺 ${String(durationSec)} 秒は Wan 2.2 5B の作れる長さ（${String(WAN_MIN_DURATION_SEC)}〜${String(
        WAN_MAX_DURATION_SEC,
      )} 秒）の外です`,
    )
  }

  if (spec.seed !== null && spec.seed > WAN_MAX_SEED) {
    // サーバは 0 〜 2³¹−1 だけ受ける。422 を待たずにここで言う。
    throw localServerInputError(
      WAN_IDENTITY,
      `seed は ${String(WAN_MAX_SEED)} 以下にしてください`,
    )
  }

  return {
    prompt: spec.prompt,
    output: { width: spec.resolution.width, height: spec.resolution.height },
    duration_seconds: durationSec,
    quality,
    seed: spec.seed,
    start_image: startImage,
  }
}
