import type { Resolution, ShotGenerationSpec } from '@ixa/domain'
import {
  ensurePromptAndSeed,
  ensurePromptLength,
  type LocalServerImage,
} from '../local-server/request.js'
import { VPIPE_FPS, VPIPE_IDENTITY, type VpipeQuality } from './descriptor.js'
import { buildH3Prompt } from './h3-prompt.js'

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
  /**
   * 終わりの画像（2026-10-24）。**本文を組む時点では null**。画像は共通の層が取り寄せてから足す
   * （`start_image` と同じ）。
   */
  readonly end_image: LocalServerImage | null
  /**
   * **常に true（ADR-0045 段 4）。** サーバは生成サイズを `output` の比へ中央で切り抜くだけで、
   * 引き伸ばさない（final・16:9 なら 1344×756 が返る）。拡大は書き出しの直前に ixa が Lanczos でやる。
   */
  readonly native: true
  /**
   * 音付きで頼む（ADR-0059）。**セリフのある Shot だけ付ける。** 無い Shot の本文は前と 1 バイトも変えない
   * （キーごと省く）。セリフの無い Shot は今まで通り音を捨てた mp4 が返る。
   */
  readonly audio?: true
}

export type BuildVpipeBody = {
  readonly spec: ShotGenerationSpec
  readonly quality: VpipeQuality
  /** 切り上げ済みの尺から戻したコマ数（17n+5）。 */
  readonly frames: number
  readonly startImage: LocalServerImage | null
  /**
   * 開始画像を送るか（プロンプトの 1 行目が変わる）。**画像そのものとは別に受ける。**
   * 投入では画像を取り寄せる前に本文を組むので、`startImage` は null でも画像は送られることがある。
   */
  readonly hasStartImage: boolean
  /** 終わりの画像を送るか（プロンプトの 1 行目が変わる）。 */
  readonly hasEndImage: boolean
}

/**
 * 仕様から本文を組む。**画像の取得はしない**（純関数。取得は `fetchStartImage`）。
 *
 * 入力の検査（プロンプト・seed）は共通の `ensurePromptAndSeed` を呼ぶ。投入の経路でも
 * 共通の層が同じ検査を先に通すが、**この関数を直に呼ぶ側（契約テスト）でも弾けるようにしておく**
 * （検査が片方にしか無いと、どちらを通ったかで通る値が変わる）。
 */
export const buildVpipeBody = (input: BuildVpipeBody): VpipeJobBody => {
  const { spec, quality, frames, startImage, hasStartImage, hasEndImage } = input
  // 画像を渡しておきながら「画像なし」の文面で組むのは、h3-official-v1 で起きた取り違え。黙って通さない。
  if (startImage !== null && !hasStartImage) {
    throw new Error('開始画像を渡しているのに、文面を「画像なし」で組もうとしています')
  }
  ensurePromptAndSeed(VPIPE_IDENTITY, spec)

  /**
   * **公式の書き方へ組み直してから送る**（ADR-0042・`h3-prompt.ts`）。
   * 組み直すと文面は長くなるので、上限はここでもう一度見る
   * （上の検査は仕様の文面に掛かっていて、送るものには掛かっていない）。
   */
  const prompt = buildH3Prompt({
    spec,
    hasStartImage,
    hasEndImage,
    // 終わりの画像は作る動画の最後に合わせる（仕様の尺ではなく、切り上げたコマ数の長さ）。
    videoSec: frames / VPIPE_FPS,
  })
  ensurePromptLength(VPIPE_IDENTITY, prompt)

  return {
    prompt,
    // 比と生成サイズを決めるために Project の解像度を渡す。`native` なので、この大きさへは拡大されない。
    output: { width: spec.resolution.width, height: spec.resolution.height },
    frames,
    quality,
    seed: spec.seed,
    steps: VPIPE_STEPS,
    start_image: startImage,
    end_image: null,
    native: true,
    ...(spec.promptParts.dialogue === undefined ? {} : { audio: true as const }),
  }
}
