import { ModelId, ProviderId } from '@ixa/domain'
import type { AspectRatio, Resolution } from '@ixa/domain'
import type { PollPolicy, VideoModelDescriptor } from '@ixa/provider-core'
import type { LocalServerIdentity } from '../local-server/identity.js'

/**
 * 手元の生成サーバ wan-api 経由の **Wan 2.2 TI2V-5B**（ADR-0040）。
 *
 * MiniMax H3（ADR-0031）と**並んで選べる**。置き換えではない。どちらも同じ機械の GPU を使うので、
 * 同時には作らない（worker が 1 本ずつに揃える。`exclusiveResource: 'local-gpu'`）。
 *
 * **実測したものと、していないものを分ける。**
 * - 実測（wan-api の `docs/benchmark.md`。2026-10-06・M5 10 コア GPU・32GB・AC 電源）:
 *   所要時間（draft 5 秒で 675 秒・standard 5 秒で 1167 秒）、開始画像の再現（SSIM 0.851）、
 *   出力が H.264・24fps・音なしで頼んだコマ数ちょうどであること、生成中の峰のメモリ 21.7〜22.8GB
 * - 未実測: 動き・物理・カメラ・文章の守り方（見た目の良し悪しは人が決める）
 *
 * 生成中の峰のメモリが 22GB 前後あることが、**この機械で 2 本同時に作らない**理由の裏付けでもある
 * （32GB を 2 本で取り合うとスワップする）。
 *
 * **AUTO の候補にしない**（`routable: false`）。手元の 1 本ずつのサーバで費用 0 なので、
 * 候補に入れると AUTO が黙ってこちらへ寄る。「使う AI」で動画に Wan を選んだときだけ、
 * その中の 2 つから AUTO が選ぶ（vpipe と同じ扱い）。
 */
export const WAN_PROVIDER_ID: ProviderId = ProviderId.parse('wan')

/** wan-api 側のワークフロー名。投入 URL の組み立てと Take の記録がこれを見る。 */
export const WAN_WORKFLOW_ID = 'wan2.2-ti2v-5b'

/** wan-api の既定の待ち受け。**このマシンからだけ**届く場所を既定にする（vpipe-api は 8765）。 */
export const WAN_DEFAULT_BASE_URL = 'http://127.0.0.1:8766'

/** Wan 2.2 TI2V-5B が出すのは 24fps（wan-api がこの fps で書き出す）。 */
export const WAN_FPS = 24

/**
 * このサーバ 1 台分の身元。共通アダプタ（`local-server/`）が、画面に出す文と失敗の code をここから作る。
 */
export const WAN_IDENTITY: LocalServerIdentity = Object.freeze({
  providerId: WAN_PROVIDER_ID,
  label: 'ローカルの動画生成（Wan）',
  codePrefix: 'wan',
  workflowId: WAN_WORKFLOW_ID,
  serverName: 'wan-api',
  startHint: '起動していません（wan-api を起動してください）',
  urlEnvName: 'WAN_API_URL',
  tokenEnvName: 'WAN_API_TOKEN',
})

/**
 * 作れる尺（秒）。**コマ数では宣言しない。**
 *
 * Wan にもコマ数の制約（4n+1）はあるが、それに合わせるのは **wan-api の責務**（ADR-0040）。
 * ixa の Shot の尺は楽曲のタイムラインが決めるので、端数の秒がそのまま来る。サーバが
 * 「必要なコマ数以上を作って、頼まれた秒ちょうど（`floor(秒 × 24 + 0.5)` コマ）に揃えて返す」
 * 契約なので、PF は秒（float）だけを持てばよく、domain にフレームが入らない（規約 3）。
 *
 * 切り詰めるのは**末尾**なので、最初のフレームを条件にした生成（I2V）では捨てる絵が無い
 * （最後のフレームを条件にする口は宣言していないため、H3 の enum 宣言のような事情は起きない）。
 *
 * **上限 5 秒は wan-api の契約そのもの**（`GET /v1/capabilities` の
 * `duration_seconds: { min: 1.0, max: 5.0 }`）。TI2V-5B の素の長さがそこまでで、ここを広げても
 * サーバが 422 で断る。
 *
 * **MiniMax H3（10.125 秒）より短い。** 5〜7.5 秒の Shot は 5 秒で作ってゆっくり再生で埋め
 * （`Shot.timing = 'fit'`）、7.5 秒を超える Shot は「Shot を分けてください」になる（ADR-0011）。
 * 長いカットは H3 か、Shot を分けて作る。
 */
export const WAN_MIN_DURATION_SEC = 1
export const WAN_MAX_DURATION_SEC = 5

/** seed の上限（wan-api の契約: 0 〜 2³¹−1）。 */
export const WAN_MAX_SEED = 2_147_483_647

/** 生成の段。wan-api がこれをモデルの実行設定（解像度・ステップ数・LoRA・量子化）へ訳す。 */
export type WanQuality = 'draft' | 'standard'

/**
 * 出力の大きさ。**wan-api が小さく作って、ちょうどこの大きさへ拡大する**（cover + 中央切り抜き）。
 * vpipe-api と同じ契約なので、Project の解像度そのものを宣言でき、technical レビューの
 * 解像度の検査もそのまま通る。生成の大きさは段と比で決まる（Wan 2.2 TI2V-5B の素は 1280x704 級）。
 */
export const WAN_ASPECT_RATIOS: readonly AspectRatio[] = Object.freeze([
  '16:9',
  '9:16',
  '1:1',
  '4:5',
] as const)

export const WAN_RESOLUTIONS: readonly Resolution[] = Object.freeze([
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
export const WAN_MAX_REFERENCE_IMAGES = 2

const capabilities: VideoModelDescriptor['capabilities'] = {
  durations: { mode: 'range', min: WAN_MIN_DURATION_SEC, max: WAN_MAX_DURATION_SEC },
  aspectRatios: [...WAN_ASPECT_RATIOS],
  resolutions: WAN_RESOLUTIONS.map((r) => ({ ...r })),
  fps: [WAN_FPS],
  referenceImages: {
    max: WAN_MAX_REFERENCE_IMAGES,
    /**
     * 開始画像にだけ使う。**最後のフレームは宣言しない**（ixa に付ける画面が無い。ADR-0031 と同じ）。
     * 最初のフレームが無ければ文章だけから作る（T2V）。vpipe と同じ振る舞いで、
     * `requiresStartFrame` は宣言しない（ADR-0025 のローカルの画像→動画とは別）。
     */
    roles: ['start_frame', 'previous_shot_last_frame'],
  },
  seed: true,
  /**
   * **宣言しない。** Wan 自体は negative prompt を解するが、ixa の仕様（`ShotGenerationSpec`）に
   * それを入れる画面が無く、`compileSpec` は常に null を渡す。効かない口ではなく「無い口」なので開けない。
   * 既定の negative prompt を持つなら wan-api の責務（モデル固有の設定は PF へ持ち込まない）。
   */
  negativePrompt: false,
  cameraControl: 'prompt',
  /** wan-api は音を付けない（出力に音声トラックが無い）。MV は楽曲を別に持つので困らない。 */
  audioGeneration: false,
}

/**
 * **実測と、していないものを分ける。**
 *
 * - 実測: 最初のフレームの再現。wan-api の計測（2026-10-06・M5・同じ開始画像・同じ文章）で、
 *   出来た動画の 1 コマ目と開始画像の SSIM は **0.851〜0.852**。同じ条件の MiniMax H3 は **0.695**。
 *   開始画像をよく保つので `characterConsistency` は H3（0.5）より上に置く
 * - 未実測: 動き・物理・カメラ・文章の守り方。**見た目の良し悪しは人が決めること**で、
 *   計測は何も点を付けていない（wan-api の benchmark.md もそう書いている）
 *
 * `routable: false` なのでルーターの比較には使われない。
 */
const qualities: VideoModelDescriptor['qualities'] = {
  characterConsistency: 0.65,
  motion: 0.7,
  physics: 0.7,
  cameraControl: 0.5,
  promptAdherence: 0.75,
}

export const WAN_TI2V_5B_DRAFT_MODEL_ID: ModelId = ModelId.parse('wan/wan2.2-ti2v-5b-draft')
export const WAN_TI2V_5B_MODEL_ID: ModelId = ModelId.parse('wan/wan2.2-ti2v-5b')

/**
 * 所要時間（秒）。**wan-api の実測**（`docs/benchmark.md`。2026-10-06・M5 10 コア GPU・32GB・
 * AC 電源・mlx-gen 0.38.0 の 8bit・出力 832x480）。
 *
 * | 段 | 尺 | 実測 |
 * |---|---|---|
 * | draft（8 step） | 5 秒 | **675 秒**（初めての文章）/ 578 秒（文章が同じで埋め込みが残っているとき） |
 * | draft（8 step） | 2.5 秒 | 279 秒（文章の埋め込みが残っているとき） |
 * | standard（20 step） | 5 秒 | **1167 秒**（同上） |
 *
 * **ixa は Shot ごとに違う文章を送る**ので、毎回「初めての文章」の分（テキストエンコーダ約 104 秒）が乗る。
 * `latencySecPerOutputSec` はそれを含めた 1〜5 秒の範囲で合わせた値で、短い尺では少し長めに出る
 * （速い方へ寄せると、待つ人が見込みを信じられなくなる）。
 *
 * 参考: 同じ条件の MiniMax H3 draft は 444 秒。**H3 のほうが速く、Wan のほうが開始画像を保つ。**
 */
export const WAN_DRAFT_TYPICAL_LATENCY_SEC = 675
export const WAN_STANDARD_TYPICAL_LATENCY_SEC = 1167
export const WAN_DRAFT_LATENCY_SEC_PER_OUTPUT_SEC = 140
export const WAN_STANDARD_LATENCY_SEC_PER_OUTPUT_SEC = 260

/**
 * 費用は 0。手元の GPU で動くので実際にかかった額そのもの（ADR-0025 の `local` と同じ）。
 * **スタブ扱いにしない**（`STUB_PROVIDER_IDS` に入れない）。本物の Take を作る。
 */
const economics = (
  typicalLatencySec: number,
  latencySecPerOutputSec: number,
): VideoModelDescriptor['economics'] => ({
  costPerSecondUsd: 0,
  typicalLatencySec,
  latencySecPerOutputSec,
})

export const wanTi2v5bDraftModel: VideoModelDescriptor = {
  id: WAN_TI2V_5B_DRAFT_MODEL_ID,
  providerId: WAN_PROVIDER_ID,
  label: 'Wan 2.2 5B 下書き（ローカル・無料）',
  capabilities,
  qualities,
  economics: economics(WAN_DRAFT_TYPICAL_LATENCY_SEC, WAN_DRAFT_LATENCY_SEC_PER_OUTPUT_SEC),
  routable: false,
}

export const wanTi2v5bModel: VideoModelDescriptor = {
  id: WAN_TI2V_5B_MODEL_ID,
  providerId: WAN_PROVIDER_ID,
  label: 'Wan 2.2 5B（ローカル・無料）',
  capabilities,
  qualities,
  economics: economics(WAN_STANDARD_TYPICAL_LATENCY_SEC, WAN_STANDARD_LATENCY_SEC_PER_OUTPUT_SEC),
  routable: false,
}

export const wanVideoModels: readonly VideoModelDescriptor[] = [wanTi2v5bDraftModel, wanTi2v5bModel]

/** モデル ID から生成の段を引く。**ID の文字列から導かない**（vpipe と同じ理由）。 */
export const WAN_MODEL_QUALITIES: Readonly<Record<string, WanQuality>> = Object.freeze({
  [WAN_TI2V_5B_DRAFT_MODEL_ID]: 'draft',
  [WAN_TI2V_5B_MODEL_ID]: 'standard',
})

/**
 * 投入後の問い合わせの間隔と回数。**30 秒おき・360 回（約 3 時間）**で vpipe と同じ（ADR-0031 §5b）。
 * 問い合わせ先は手元のサーバなので細かく聞いても費用も負荷もほとんど無く、作り終わりに早く気付ける。
 * 回数は、前の 1 本（最長の生成）＋自分 を覆うように取る。
 */
export const WAN_POLL_POLICY: PollPolicy = Object.freeze({
  maxIntervalMs: 30_000,
  maxAttempts: 360,
})
