import type { Resolution, ShotGenerationSpec } from '@ixa/domain'
import {
  ensurePromptAndSeed,
  type LocalServerImage,
} from '../local-server/request.js'
import { VPIPE_IDENTITY, type VpipeQuality } from './descriptor.js'

/**
 * MiniMax H3（vpipe-api の `minimax-h3-turbo-video`）の投入の本文。
 * 共通の部分（プロンプトの上限・開始画像の形・参照の選び方）は `local-server/request.ts`。
 */

/**
 * Turbo LoRA のノイズ除去ステップ数。**サーバの既定（6）に任せず明示する。**
 * サーバ側の既定が変わると、同じ仕様から違う映像が出る（ADR-0003 の再現性が崩れる）。
 * 4〜8 を受けるが、6 は vpipe-api の既定であり実測の所要時間もこの値で測っている。
 *
 * **これは H3 だけの事情。** Wan（ADR-0040）はステップ数を送らず、サーバが段から決める。
 */
export const VPIPE_STEPS = 6

/** `POST /v1/workflows/minimax-h3-turbo-video/jobs` の本文。 */
export type VpipeJobBody = {
  readonly prompt: string
  readonly output: Resolution
  readonly frames: number
  readonly quality: VpipeQuality
  readonly seed: number | null
  readonly steps: number
  readonly start_image: LocalServerImage | null
  /** **常に null。** 最後のフレームを付ける画面がまだ無い（ADR-0031 の次の段階）。 */
  readonly end_image: null
}

export type BuildVpipeBody = {
  readonly spec: ShotGenerationSpec
  readonly quality: VpipeQuality
  /** 切り上げ済みの尺から戻したコマ数（17n+5）。 */
  readonly frames: number
  readonly startImage: LocalServerImage | null
}

/**
 * 仕様から本文を組む。**画像の取得はしない**（純関数。取得は `fetchStartImage`）。
 *
 * 入力の検査（プロンプト・seed）は共通の `ensurePromptAndSeed` を呼ぶ。投入の経路でも
 * 共通の層が同じ検査を先に通すが、**この関数を直に呼ぶ側（契約テスト）でも弾けるようにしておく**
 * （検査が片方にしか無いと、どちらを通ったかで通る値が変わる）。
 */
export const buildVpipeBody = (input: BuildVpipeBody): VpipeJobBody => {
  const { spec, quality, frames, startImage } = input
  ensurePromptAndSeed(VPIPE_IDENTITY, spec)

  return {
    prompt: spec.prompt,
    // サーバが小さく作ってこの大きさへ拡大する。Project の解像度そのものを渡す。
    output: { width: spec.resolution.width, height: spec.resolution.height },
    frames,
    quality,
    seed: spec.seed,
    steps: VPIPE_STEPS,
    start_image: startImage,
    end_image: null,
  }
}
