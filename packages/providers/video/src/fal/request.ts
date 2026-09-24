import type { ReferenceRole, ShotGenerationSpec } from '@ixa/domain'
import { ProviderError } from '@ixa/provider-core'
import {
  FAL_MAX_IMAGE_REFERENCES,
  FAL_PROVIDER_ID,
  FAL_SEEDANCE_ASPECT_RATIOS,
  resolutionTierFor,
  type FalResolutionTier,
} from './descriptor.js'

/**
 * **音は必ず切る。**
 *
 * 本システムは楽曲を別に持ち、タイムラインで音を組む（ADR-0009 / ARCHITECTURE.md）。
 * モデルが付けた音は書き出しの段階で必ず捨てられるので、既定の true のまま投げると
 * 誰も聴かない音に尺ぶんの時間と費用を払うことになる。しかも Take の中に
 * 「聴こえない音が入った映像」が残り、レビューで原因の分からない違和感になる。
 * **設定にしない。** 切り替えられるようにすると capability の宣言と食い違う口ができる。
 */
export const FAL_GENERATE_AUDIO = false

/**
 * `task`（2.5 で増えた軸）。**`reference` に固定する。**
 *
 * 2.5 は 1 つのエンドポイントで 3 つの仕事を兼ねる:
 * `reference`（参照から作る）/ `editing`（既存の映像を直す）/ `extension`（映像の続きを作る）。
 * 本システムが Shot に対してやるのは常に前者で、後者 2 つは `video_urls` に
 * 元の映像を渡すことが前提になる。**ドメインの `ReferenceRole` はすべて静止画**なので
 * （`start_frame` / `end_frame` / `previous_shot_last_frame` も 1 枚の絵）、
 * 渡せる映像が最初から存在しない。使う当てのない軸を設定にすると、
 * capability 宣言の外側に「試せるが必ず失敗する口」を作ることになる。
 *
 * 続きものを作りたくなったら、`extension` は `video_urls` と新しい role を要るので、
 * ドメイン側の変更（= Architect の判断）から始まる。そのときにここを開ければよい。
 */
export const FAL_TASK = 'reference'

/**
 * `codec`（2.5 で増えた軸）。**`auto` に任せず H264 を明示する。**
 *
 * 書き出しは Remotion + ffmpeg（ADR-0010）で、素材は「同一 fps / 同一解像度 /
 * 同一コーデック」の中間形式へ揃えてから合成する（ARCHITECTURE.md §874 付近）。
 * `auto` はモデル側の都合で H264 と H265 が混ざりうる。混ざると Take ごとに
 * 再エンコードの要否が変わり、**書き出しの時間と画質が Take によってばらつく**。
 * しかもそれが現れるのは合成の段階で、生成の時点では何も起きないので原因が遠い。
 * H264 は Remotion / ブラウザ / QuickTime のどれでもそのまま再生でき、
 * レビュー画面のプレビューが Take によって映らない事故も防げる。
 */
export const FAL_CODEC = 'H264'

/**
 * `bitrate_mode`（2.5 で増えた軸）は**送らず fal の既定（`standard`）に任せる**。
 * 画質の軸は Project の解像度で持っており、ここを触ると同じ仕様の Take の間で
 * ビットレートだけが変わる。既定に任せていることを検査で固定しておくための印。
 */
export const FAL_BITRATE_MODE_IS_DEFAULT = true

export type FalSeedanceInput = {
  readonly prompt: string
  readonly image_urls?: readonly string[]
  readonly resolution: FalResolutionTier
  readonly duration: number
  readonly aspect_ratio: string
  readonly generate_audio: boolean
  readonly task: typeof FAL_TASK
  readonly codec: typeof FAL_CODEC
  readonly seed?: number
}

/** 参照 1 つ分。`spec.references` の要素と同じ形。 */
type SpecReference = { readonly role: ReferenceRole }

const MENTION_MARKER = '@Image'

/**
 * Seedance の参照は **本文から `@Image1` の形で指す**（2.0 / 2.5 とも）。
 * 画像を渡しただけでは何のための絵かが伝わらないので、並び順と role の対応を添える。
 *
 * **並べ替えはしない。** `spec.references` は `resolveReferences`（domain）が
 * 優先度順に並べて上限で切った後の確定した列で、その順序がキャラクター一貫性を
 * 決めている（ARCHITECTURE.md §8）。ここで並べ直すと、その判断を捨てたうえに
 * `@ImageN` と画像の対応もずれる。だから添字は列の位置そのままにする。
 *
 * 本文が既に `@Image` を含むなら何もしない。人が書いた指し方を上書きしないため。
 */
export const withReferenceMentions = (
  prompt: string,
  references: readonly SpecReference[],
): string => {
  if (references.length === 0 || prompt.includes(MENTION_MARKER)) return prompt
  const legend = references
    .map((reference, index) => `${MENTION_MARKER}${String(index + 1)} = ${reference.role}`)
    .join(', ')
  return `${prompt}\n\nReferences: ${legend}`
}

export type BuildSeedanceInput = {
  readonly spec: ShotGenerationSpec
  /** モデルが出せる値へ切り上げた後の尺（ADR-0011）。`auto` は使わない。 */
  readonly generationDurationSec: number
  /** `spec.references` と**同じ並び・同じ個数**の解決済み URL。 */
  readonly referenceUrls: readonly string[]
}

const inputError = (message: string): ProviderError =>
  new ProviderError(message, FAL_PROVIDER_ID, false)

export const buildSeedanceInput = (input: BuildSeedanceInput): FalSeedanceInput => {
  const { spec, generationDurationSec, referenceUrls } = input

  if (referenceUrls.length !== spec.references.length) {
    throw inputError(
      `参照の数が合いません（仕様 ${String(spec.references.length)} 件 / 解決 ${String(referenceUrls.length)} 件）`,
    )
  }
  if (referenceUrls.length > FAL_MAX_IMAGE_REFERENCES) {
    throw inputError(
      `参照画像が ${String(referenceUrls.length)} 枚で上限 ${String(FAL_MAX_IMAGE_REFERENCES)} 枚を超えています`,
    )
  }
  if (!FAL_SEEDANCE_ASPECT_RATIOS.includes(spec.aspectRatio)) {
    throw inputError(`アスペクト比 ${spec.aspectRatio} には対応していません`)
  }

  const resolution = resolutionTierFor(spec.resolution)
  if (resolution === null) {
    throw inputError(
      `解像度 ${String(spec.resolution.width)}x${String(spec.resolution.height)} は fal の段（480p/720p/1080p）に載りません`,
    )
  }

  return {
    prompt: withReferenceMentions(spec.prompt, spec.references),
    ...(referenceUrls.length === 0 ? {} : { image_urls: [...referenceUrls] }),
    resolution,
    duration: generationDurationSec,
    aspect_ratio: spec.aspectRatio,
    generate_audio: FAL_GENERATE_AUDIO,
    task: FAL_TASK,
    codec: FAL_CODEC,
    ...(spec.seed === null ? {} : { seed: spec.seed }),
  }
}
