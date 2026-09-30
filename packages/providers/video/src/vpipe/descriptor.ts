import { ModelId, ProviderId } from '@ixa/domain'
import type { AspectRatio, Resolution } from '@ixa/domain'
import { ProviderError, type PollPolicy, type VideoModelDescriptor } from '@ixa/provider-core'

/**
 * 手元の生成サーバ vpipe-api（https://github.com/kabatin/vpipe-api）経由の
 * MiniMax H3 Turbo（ADR-0031）。
 *
 * **実測したものと、していないものを分けて書く。** 実測は M5（10 コア GPU・32GB）の Mac 1 台。
 * - 実測: 所要時間（832x480×124 コマ ≈ 7 分 / 1024x576×124 コマ ≈ 10.6 分 / 1024x576×243 コマ ≈ 24 分）、
 *   出せるコマ数（17n+5、24fps）、出力が H.264・24fps・音なしであること
 * - 未実測: qualities（見た目の相対評価。サンプル 40 本を目で見ただけ）
 *
 * **AUTO の候補にしない**（`routable: false`）。1 本に 7〜25 分かかり 1 本ずつしか作れないうえ、
 * 費用 0 がスコアで圧倒的に有利になり、AUTO が黙ってこちらへ寄ってしまう。明示して選ばせる。
 */
export const VPIPE_PROVIDER_ID: ProviderId = ProviderId.parse('vpipe')

/** vpipe-api 側のワークフロー名。URL の組み立てと raw の記録がこれを見る。 */
export const VPIPE_WORKFLOW_ID = 'minimax-h3-turbo-video'

/** vpipe-api の既定の待ち受け。**このマシンからだけ**届く場所を既定にする。 */
export const VPIPE_DEFAULT_BASE_URL = 'http://127.0.0.1:8765'

/** H3 が出すのは 24fps だけ（実測）。 */
export const VPIPE_FPS = 24

/**
 * H3 が作れるコマ数は **17n+5** だけ（n = 3..14 → 56〜243 コマ = 2.333〜10.125 秒）。
 * vpipe-api はこれ以外を 422 で断る。出来たコマ数はそのまま返り、切り詰めない。
 */
export const VPIPE_FRAME_STEP = 17
export const VPIPE_FRAME_OFFSET = 5
export const VPIPE_MIN_FRAME_BLOCKS = 3
export const VPIPE_MAX_FRAME_BLOCKS = 14

export const isNativeFrameCount = (frames: number): boolean => {
  const blocks = (frames - VPIPE_FRAME_OFFSET) / VPIPE_FRAME_STEP
  return (
    Number.isInteger(blocks) && blocks >= VPIPE_MIN_FRAME_BLOCKS && blocks <= VPIPE_MAX_FRAME_BLOCKS
  )
}

/** 秒は小数 3 桁で持つ（`round(秒 × 24)` でコマ数へ正確に戻せる桁数）。 */
const toDurationSec = (frames: number): number => Math.round((frames / VPIPE_FPS) * 1000) / 1000

/** 作れるコマ数の一覧（56, 73, …, 243）。 */
export const VPIPE_NATIVE_FRAME_COUNTS: readonly number[] = Object.freeze(
  Array.from(
    { length: VPIPE_MAX_FRAME_BLOCKS - VPIPE_MIN_FRAME_BLOCKS + 1 },
    (_unused, i) => (VPIPE_MIN_FRAME_BLOCKS + i) * VPIPE_FRAME_STEP + VPIPE_FRAME_OFFSET,
  ),
)

/**
 * 宣言する尺（2.333, 3.042, …, 10.125 秒）。**H3 が素で出せる長さだけを並べる。**
 *
 * 範囲（range）で宣言すると、たとえば 4 秒の要求に 4.458 秒の映像が返り、切り詰めが要る。
 * 切り詰めると最後のフレームを条件にした生成で、その最後の絵を捨てることになる。
 * 素の長さを宣言すれば ADR-0011 の切り上げがここに載り、生成尺と実測尺が一致して
 * technical レビューの尺の検査（±0.05 秒）もそのまま通る。
 */
export const VPIPE_DURATIONS_SEC: readonly number[] = Object.freeze(
  VPIPE_NATIVE_FRAME_COUNTS.map(toDurationSec),
)

/**
 * 切り上げ済みの尺（`VPIPE_DURATIONS_SEC` のどれか）をコマ数へ戻す。
 * **17n+5 に載らなければ投げる。** 近いコマ数へ丸めて投げると、生成尺と実測尺が黙ってずれる。
 */
export const framesForDuration = (durationSec: number): number => {
  const frames = Math.round(durationSec * VPIPE_FPS)
  if (!isNativeFrameCount(frames)) {
    throw new ProviderError(
      `尺 ${String(durationSec)} 秒は MiniMax H3 の作れる長さ（17n+5 コマ）に載りません`,
      VPIPE_PROVIDER_ID,
      false,
    )
  }
  return frames
}

/** 生成の段。vpipe-api が比ごとに生成する大きさを決める（draft は小さく速い）。 */
export type VpipeQuality = 'draft' | 'standard'

/**
 * 出力の大きさ。**vpipe-api が小さく作って、ちょうどこの大きさへ拡大する**（cover + 中央切り抜き）。
 * だから Project の解像度そのものを宣言でき、technical レビューの解像度の検査も通る。
 * 生成の大きさは段と比で決まる（16:9 なら draft 832x480 / standard 1024x576）。
 */
export const VPIPE_ASPECT_RATIOS: readonly AspectRatio[] = Object.freeze([
  '16:9',
  '9:16',
  '1:1',
  '4:5',
] as const)

export const VPIPE_RESOLUTIONS: readonly Resolution[] = Object.freeze([
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1080, height: 1920 },
  { width: 720, height: 1280 },
  { width: 1080, height: 1080 },
  { width: 720, height: 720 },
  { width: 1080, height: 1350 },
  { width: 864, height: 1080 },
])

/** 最初のフレームとして受け取れる参照の枠。どちらも「開始画像」1 枚へ落ちる（ADR-0016）。 */
export const VPIPE_MAX_REFERENCE_IMAGES = 2

const capabilities: VideoModelDescriptor['capabilities'] = {
  durations: { mode: 'enum', values: [...VPIPE_DURATIONS_SEC] },
  aspectRatios: [...VPIPE_ASPECT_RATIOS],
  resolutions: VPIPE_RESOLUTIONS.map((r) => ({ ...r })),
  fps: [VPIPE_FPS],
  referenceImages: {
    max: VPIPE_MAX_REFERENCE_IMAGES,
    /**
     * 開始画像にだけ使う。**end_frame は宣言しない。** vpipe-api は最後のフレームも受けるが、
     * ixa にはまだ最後のフレームを付ける画面が無い（次の段階。ADR-0031）。
     */
    roles: ['start_frame', 'previous_shot_last_frame'],
  },
  seed: true,
  /** ガイダンス蒸留済みのモデルで、negative prompt は効かない。効かない口を開けない。 */
  negativePrompt: false,
  cameraControl: 'prompt',
  /** vpipe-api は音を捨てる（出力に音声トラックが無い）。 */
  audioGeneration: false,
}

/**
 * **すべて未実測の相対値。** サンプル 40 本を目で見た印象で置いている。
 * 参照は開始画像 1 枚だけなので、人物の一貫性は開始画像の出来に依存する（0.5）。
 */
const qualities: VideoModelDescriptor['qualities'] = {
  characterConsistency: 0.5,
  motion: 0.75,
  physics: 0.7,
  cameraControl: 0.5,
  promptAdherence: 0.8,
}

export const VPIPE_H3_TURBO_DRAFT_MODEL_ID: ModelId = ModelId.parse('vpipe/minimax-h3-turbo-draft')
export const VPIPE_H3_TURBO_MODEL_ID: ModelId = ModelId.parse('vpipe/minimax-h3-turbo')

/**
 * 所要時間の見込み（秒）。124 コマ（5.167 秒）の実測値。
 * draft ≈ 7 分、standard ≈ 10.6 分。243 コマの standard は ≈ 24 分かかる。
 */
export const VPIPE_DRAFT_TYPICAL_LATENCY_SEC = 420
export const VPIPE_STANDARD_TYPICAL_LATENCY_SEC = 640

/**
 * 費用は 0。手元の GPU で動くので実際にかかった額そのもの（ADR-0025 の `local` と同じ）。
 * **スタブ扱いにしない**（`STUB_PROVIDER_IDS` に入れない）。本物の Take を作る。
 */
const economics = (typicalLatencySec: number): VideoModelDescriptor['economics'] => ({
  costPerSecondUsd: 0,
  typicalLatencySec,
})

export const vpipeH3TurboDraftModel: VideoModelDescriptor = {
  id: VPIPE_H3_TURBO_DRAFT_MODEL_ID,
  providerId: VPIPE_PROVIDER_ID,
  label: 'MiniMax H3 Turbo 下書き（ローカル・無料）',
  capabilities,
  qualities,
  economics: economics(VPIPE_DRAFT_TYPICAL_LATENCY_SEC),
  routable: false,
}

export const vpipeH3TurboModel: VideoModelDescriptor = {
  id: VPIPE_H3_TURBO_MODEL_ID,
  providerId: VPIPE_PROVIDER_ID,
  label: 'MiniMax H3 Turbo（ローカル・無料）',
  capabilities,
  qualities,
  economics: economics(VPIPE_STANDARD_TYPICAL_LATENCY_SEC),
  routable: false,
}

export const vpipeVideoModels: readonly VideoModelDescriptor[] = [
  vpipeH3TurboDraftModel,
  vpipeH3TurboModel,
]

/** モデル ID から生成の段を引く。ID の文字列から導かない（fal の `FAL_MODEL_PATHS` と同じ理由）。 */
export const VPIPE_MODEL_QUALITIES: Readonly<Record<string, VpipeQuality>> = Object.freeze({
  [VPIPE_H3_TURBO_DRAFT_MODEL_ID]: 'draft',
  [VPIPE_H3_TURBO_MODEL_ID]: 'standard',
})

/**
 * 投入後の問い合わせの間隔と回数（ADR-0031）。**30 秒おき・360 回（約 3 時間）。**
 *
 * worker の既定（5 秒から倍々で最大 2 分おき）では、実機の E2E でサーバが作り終えてから
 * ixa が気付くまで 9〜99 秒遅れた。1 本 3〜25 分の生成に最大 2 分の遅れは大きく、
 * しかも問い合わせ先は手元のサーバなので、細かく聞いても費用も負荷もほとんど無い。
 *
 * 回数は、投入後に待ちうる最悪の時間を覆うように取る。受け付けられたジョブの前には
 * 走っている 1 本しかいない（待ちの枠が既定の 1 のとき）ので、最悪は
 * 前の 1 本（243 コマの standard で約 25 分）+ 自分（約 25 分）= 約 50 分。
 * サーバの再起動や、書き出し・Codex とのメモリの取り合いで遅くなる分を見て約 3 時間とし、
 * 30 秒おきで 360 回（冒頭の 5・10・20 秒を含めて約 179 分）にする。
 */
export const VPIPE_POLL_POLICY: PollPolicy = Object.freeze({
  maxIntervalMs: 30_000,
  maxAttempts: 360,
})
