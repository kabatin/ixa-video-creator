import type { Resolution, ShotGenerationSpec } from '@ixa/domain'
import { ProviderError } from '@ixa/provider-core'
import type { ReferenceRole } from '@ixa/domain'
import { VPIPE_PROVIDER_ID, type VpipeQuality } from './descriptor.js'
import type { VpipeFetch } from './http.js'
import { BodyTooLargeError, declaresTooLarge, readAllWithLimit } from './stream.js'

/**
 * Turbo LoRA のノイズ除去ステップ数。**サーバの既定（6）に任せず明示する。**
 * サーバ側の既定が変わると、同じ仕様から違う映像が出る（ADR-0003 の再現性が崩れる）。
 * 4〜8 を受けるが、6 は vpipe-api の既定であり実測の所要時間もこの値で測っている。
 */
export const VPIPE_STEPS = 6

/** プロンプトの上限（vpipe-api の契約。文字数はコードポイントで数える）。 */
export const VPIPE_MAX_PROMPT_CHARS = 4000

export const VPIPE_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type VpipeImageMediaType = (typeof VPIPE_IMAGE_MEDIA_TYPES)[number]

/** 開始画像 1 枚の上限（vpipe-api の契約。base64 を戻した大きさ）。 */
export const VPIPE_MAX_IMAGE_BYTES = 20 * 1024 * 1024

export type VpipeImage = {
  readonly data: string
  readonly media_type: VpipeImageMediaType
}

/** `POST /v1/workflows/minimax-h3-turbo-video/jobs` の本文。 */
export type VpipeJobBody = {
  readonly prompt: string
  readonly output: Resolution
  readonly frames: number
  readonly quality: VpipeQuality
  readonly seed: number | null
  readonly steps: number
  readonly start_image: VpipeImage | null
  /** **常に null。** 最後のフレームを付ける画面がまだ無い（ADR-0031 の次の段階）。 */
  readonly end_image: null
}

type SpecReference = ShotGenerationSpec['references'][number]

/**
 * 開始画像にする role の優先順。**明示したキーフレームが先、前の Shot から導いた推測が後**
 * （ADR-0016。`REFERENCE_PRIORITY` の並びとも一致する）。
 */
const START_IMAGE_ROLES: readonly ReferenceRole[] = ['start_frame', 'previous_shot_last_frame']

export type StartImageSelection = {
  /** 開始画像に使う参照。無ければ文章だけから作る（text-to-video）。 */
  readonly chosen: SpecReference | null
  /** 枠が 1 つしか無いので使わなかった参照。黙って捨てず、記録に残す。 */
  readonly ignored: readonly SpecReference[]
}

/**
 * 参照から開始画像を 1 枚選ぶ。**仕様の純関数**なので、`Take.spec` からいつでも同じ選択を再現できる。
 * 同じ role が複数あれば最初の 1 枚（`resolveReferences` が並べた順）を使う。
 */
export const selectStartReference = (references: readonly SpecReference[]): StartImageSelection => {
  const chosen =
    START_IMAGE_ROLES.map((role) => references.find((reference) => reference.role === role)).find(
      (reference): reference is SpecReference => reference !== undefined,
    ) ?? null
  return { chosen, ignored: references.filter((reference) => reference !== chosen) }
}

const inputError = (message: string): ProviderError =>
  new ProviderError(message, VPIPE_PROVIDER_ID, false)

/** Content-Type から画像の形式を読む。`image/jpg` は `image/jpeg` の書き癖として受ける。 */
export const imageMediaTypeOf = (contentType: string | null): VpipeImageMediaType | null => {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  const normalized = base === 'image/jpg' ? 'image/jpeg' : base
  return VPIPE_IMAGE_MEDIA_TYPES.find((type) => type === normalized) ?? null
}

const START_IMAGE_UNREADABLE = '最初のフレームの画像を読み込めませんでした'
const TOO_LARGE = '最初のフレームの画像が大きすぎます（20MB まで）'

/**
 * 開始画像を取りに行き、base64 にする。
 *
 * `url` は署名付き URL。**例外にもログにも載せない**（CLAUDE.md 規約 7）。
 * vpipe-api へは URL ではなく中身を送る（サーバからストレージが見えるとは限らないため）。
 */
export const fetchStartImage = async (
  fetch: VpipeFetch,
  url: string,
  timeoutMs: number,
): Promise<VpipeImage> => {
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await (async (): Promise<Response> => {
    try {
      return await fetch(url, { method: 'GET', signal })
    } catch (cause) {
      throw new ProviderError(START_IMAGE_UNREADABLE, VPIPE_PROVIDER_ID, true, { cause })
    }
  })()

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const retryable = response.status === 429 || response.status >= 500
    throw new ProviderError(
      `${START_IMAGE_UNREADABLE}（HTTP ${String(response.status)}）`,
      VPIPE_PROVIDER_ID,
      retryable,
    )
  }

  const mediaType = imageMediaTypeOf(response.headers.get('content-type'))
  const body: ReadableStream<Uint8Array> | null = response.body
  // 送れないと分かっている本文は読まない（読み取りを取り消して接続を返す）。
  const reject = async (message: string): Promise<never> => {
    await body?.cancel().catch(() => undefined)
    throw inputError(message)
  }
  if (mediaType === null)
    return reject('最初のフレームの画像は PNG・JPEG・WebP のどれかにしてください')
  if (declaresTooLarge(response.headers, VPIPE_MAX_IMAGE_BYTES)) return reject(TOO_LARGE)
  if (body === null) return reject('最初のフレームの画像が空です')

  const bytes = await (async (): Promise<Uint8Array> => {
    try {
      // 丸ごと読んでから確かめない。上限を超えた時点で止める。
      return await readAllWithLimit(body, VPIPE_MAX_IMAGE_BYTES)
    } catch (cause) {
      if (cause instanceof BodyTooLargeError) throw inputError(TOO_LARGE)
      throw new ProviderError(START_IMAGE_UNREADABLE, VPIPE_PROVIDER_ID, true, { cause })
    }
  })()

  if (bytes.byteLength === 0) throw inputError('最初のフレームの画像が空です')
  return { data: Buffer.from(bytes).toString('base64'), media_type: mediaType }
}

export type BuildVpipeBody = {
  readonly spec: ShotGenerationSpec
  readonly quality: VpipeQuality
  /** 切り上げ済みの尺から戻したコマ数（17n+5）。 */
  readonly frames: number
  readonly startImage: VpipeImage | null
}

/** 仕様から本文を組む。**画像の取得はしない**（純関数。取得は `fetchStartImage`）。 */
export const buildVpipeBody = (input: BuildVpipeBody): VpipeJobBody => {
  const { spec, quality, frames, startImage } = input
  const promptChars = [...spec.prompt].length
  if (spec.prompt.trim() === '') throw inputError('プロンプトが空です')
  if (promptChars > VPIPE_MAX_PROMPT_CHARS) {
    throw inputError(
      `プロンプトが ${String(promptChars)} 文字あり、上限 ${String(VPIPE_MAX_PROMPT_CHARS)} 文字を超えています`,
    )
  }
  if (spec.seed !== null && spec.seed < 0) throw inputError('seed は 0 以上にしてください')

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
