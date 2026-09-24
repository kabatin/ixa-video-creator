import { ModelId, ProviderId, ReferenceRole } from '@ixa/domain'
import type { AspectRatio, Resolution } from '@ixa/domain'
import type { VideoModelDescriptor } from '@ixa/provider-core'

/**
 * fal.ai 経由の Seedance（ADR-0013 Phase 1）。
 *
 * **ここに書いた capability はすべてドキュメント由来で、実キーでの疎通は済んでいない。**
 * ADR-0013 の Follow-up が「実キー疎通で実測して capability 記述を確定する」と言っている。
 * 実測前の値を確定値として扱わないこと。実測が要る項目は各宣言のコメントに印を付けてある
 * （`未実測` と書いてある行）。
 */
export const FAL_PROVIDER_ID: ProviderId = ProviderId.parse('fal')

/** Queue API の入口。すべての経路がここから組み立てられる。 */
export const FAL_QUEUE_BASE_URL = 'https://queue.fal.run'

/** fal のモデル経路。URL の組み立てとモデル ID の両方がこの 1 つを見る。 */
export const FAL_SEEDANCE_REFERENCE_TO_VIDEO_PATH = 'bytedance/seedance-2.0/reference-to-video'

export const FAL_SEEDANCE_REFERENCE_TO_VIDEO_MODEL_ID: ModelId = ModelId.parse(
  `fal/${FAL_SEEDANCE_REFERENCE_TO_VIDEO_PATH}`,
)

/**
 * fal は画素数ではなく段（tier）でしか解像度を指定できない。
 * Domain の `Resolution` は画素数なので、**短辺で段へ写す**。
 * 縦横どちらの構図でも同じ段になり、比率を変えても対応表を増やさずに済む。
 */
export const FAL_RESOLUTION_TIERS = ['480p', '720p', '1080p'] as const
export type FalResolutionTier = (typeof FAL_RESOLUTION_TIERS)[number]

export const FAL_RESOLUTION_SHORT_SIDE: Readonly<Record<FalResolutionTier, number>> = Object.freeze(
  { '480p': 480, '720p': 720, '1080p': 1080 },
)

/**
 * fal 側は auto / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 を受ける。
 * Domain の `AspectRatio` との積集合だけを宣言する（4:3 と 3:4 は Domain に無く、
 * Domain の 4:5 は fal に無い）。**片方にしか無い値を宣言しない。**
 */
export const FAL_SEEDANCE_ASPECT_RATIOS: readonly AspectRatio[] = Object.freeze([
  '16:9',
  '9:16',
  '1:1',
  '21:9',
] as const)

/** 画像参照の上限（未実測。ドキュメントの値）。 */
export const FAL_MAX_IMAGE_REFERENCES = 9

/**
 * 画像・動画・音声を合わせた総ファイル数の上限（未実測）。
 * Phase 1 は画像しか送らないので `FAL_MAX_IMAGE_REFERENCES` のほうが先に効く。
 */
export const FAL_MAX_REFERENCE_FILES = 12

/**
 * 秒単価。**映像入力の有無で変わる。**
 *
 * Domain の `ReferenceRole` はすべて静止画（`start_frame` / `end_frame` /
 * `previous_shot_last_frame` も 1 枚の絵）なので、このアダプタは `video_urls` を
 * 一度も使わない。よって実際に効くのは常に「映像入力なし」のほうである。
 * 安いほうを descriptor に載せると、見積が実際より低く出て予算ガードが素通りする。
 */
export const FAL_SEEDANCE_COST_PER_SECOND_USD = 0.3024
/** 映像入力ありの単価。Phase 1 では使わないが、取り違えを防ぐため名前を付けて置く。 */
export const FAL_SEEDANCE_COST_PER_SECOND_WITH_VIDEO_USD = 0.1814

/** 1 生成あたりの所要時間の見込み（未実測。Router のスコアリングにしか使わない）。 */
export const FAL_SEEDANCE_TYPICAL_LATENCY_SEC = 90

const parseRatio = (aspectRatio: string): readonly [number, number] => {
  const parts = aspectRatio.split(':')
  const w = Number(parts[0])
  const h = Number(parts[1])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`アスペクト比を解釈できません: ${aspectRatio}`)
  }
  return [w, h]
}

/** 偶数へ寄せる。奇数の幅は多くのエンコーダが受け付けない。 */
const toEven = (value: number): number => Math.round(value / 2) * 2

/** 比率と段から画素数を出す。短辺が段の値になる。 */
export const pixelSizeFor = (aspectRatio: AspectRatio, tier: FalResolutionTier): Resolution => {
  const short = FAL_RESOLUTION_SHORT_SIDE[tier]
  const [w, h] = parseRatio(aspectRatio)
  return w >= h
    ? { width: toEven((short * w) / h), height: short }
    : { width: short, height: toEven((short * h) / w) }
}

/**
 * 画素数から段へ戻す。**近い段へ丸めない。**
 * 勝手に丸めると、Project が指定した解像度と違うものが黙って焼かれ、
 * technical レビューの解像度チェックで初めて気付くことになる。
 */
export const resolutionTierFor = (resolution: Resolution): FalResolutionTier | null => {
  const short = Math.min(resolution.width, resolution.height)
  return FAL_RESOLUTION_TIERS.find((tier) => FAL_RESOLUTION_SHORT_SIDE[tier] === short) ?? null
}

const SUPPORTED_RESOLUTIONS: readonly Resolution[] = FAL_SEEDANCE_ASPECT_RATIOS.flatMap(
  (aspectRatio) => FAL_RESOLUTION_TIERS.map((tier) => pixelSizeFor(aspectRatio, tier)),
)

export const falSeedanceReferenceToVideoModel: VideoModelDescriptor = {
  id: FAL_SEEDANCE_REFERENCE_TO_VIDEO_MODEL_ID,
  providerId: FAL_PROVIDER_ID,
  label: 'Seedance 2.0 reference-to-video (fal.ai)',
  capabilities: {
    /**
     * `duration` は `auto` か 4〜15 秒（未実測。刻みが整数かどうかも含めて確認が要る）。
     * `auto` は使わない。尺が決まらないと費用も編集尺も決まらないため。
     */
    durations: { mode: 'range', min: 4, max: 15, step: 1 },
    aspectRatios: [...FAL_SEEDANCE_ASPECT_RATIOS],
    resolutions: SUPPORTED_RESOLUTIONS.map((r) => ({ ...r })),
    /**
     * **未実測かつ入力に無い。** fal の入力に fps の項目が無く、Seedance の出力は
     * 24fps とされている。30fps の Project ではこのモデルが候補から外れる。
     * 実測で確かめるまで 24 以外を足さないこと（足すと「出せる」と嘘をつくことになる）。
     */
    fps: [24],
    referenceImages: {
      max: FAL_MAX_IMAGE_REFERENCES,
      /**
       * **モデル側に role の概念が無い。** 参照はただの画像で、本文の `@ImageN` が
       * 意味づけを担う。よってドメインの全 role を受ける。
       * ここで role を絞ると `resolveReferences` が候補を落とすだけで、
       * モデルの制約を表したことにはならない。
       */
      roles: [...ReferenceRole.options],
    },
    seed: true,
    /** 入力に negative prompt が無い（未実測）。 */
    negativePrompt: false,
    cameraControl: 'prompt',
    /**
     * モデル自体は `generate_audio` を持つが、**このアダプタは常に false で投げる**
     * （`request.ts` の `FAL_GENERATE_AUDIO`）。本システムは楽曲を別に持ち、
     * タイムラインで音を組む。生成音は必ず捨てられるので、ここを true と宣言すると
     * Router が「音を出せる」ことを理由にこのモデルを選びかねない。
     * **宣言はアダプタの実際の振る舞いに合わせる。**
     */
    audioGeneration: false,
  },
  /**
   * **すべて未実測の相対値**（ADR-0004 の言う「Architect が実測と評判から与える値」）。
   * reference-to-video は参照でキャラクターを固定する用途のモデルなので
   * characterConsistency を高めに置いているが、根拠は実測ではない。
   */
  qualities: {
    characterConsistency: 0.85,
    motion: 0.85,
    physics: 0.8,
    cameraControl: 0.5,
    promptAdherence: 0.85,
  },
  economics: {
    costPerSecondUsd: FAL_SEEDANCE_COST_PER_SECOND_USD,
    typicalLatencySec: FAL_SEEDANCE_TYPICAL_LATENCY_SEC,
  },
}

export const falVideoModels: readonly VideoModelDescriptor[] = [falSeedanceReferenceToVideoModel]

/**
 * モデル ID から fal のエンドポイント経路を引く表。
 * ID から文字列操作で導かない。モデルが増えたとき、経路と ID の対応は自明ではない。
 */
export const FAL_MODEL_PATHS: Readonly<Record<string, string>> = Object.freeze({
  [FAL_SEEDANCE_REFERENCE_TO_VIDEO_MODEL_ID]: FAL_SEEDANCE_REFERENCE_TO_VIDEO_PATH,
})
