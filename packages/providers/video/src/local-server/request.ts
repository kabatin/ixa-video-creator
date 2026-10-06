import type { ReferenceRole, ShotGenerationSpec } from '@ixa/domain'
import { ProviderError } from '@ixa/provider-core'
import type { LocalServerFetch } from './http.js'
import type { LocalServerIdentity } from './identity.js'
import { BodyTooLargeError, declaresTooLarge, readAllWithLimit } from './stream.js'

/**
 * 投入の本文のうち、**どのサーバでも同じ部分**（vpipe-api v1 契約）。
 * モデル固有の項目（コマ数・ステップ数・尺の渡し方）は各サーバのアダプタが足す。
 */

/** プロンプトの上限（契約。文字数はコードポイントで数える）。 */
export const LOCAL_SERVER_MAX_PROMPT_CHARS = 4000

export const LOCAL_SERVER_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type LocalServerImageMediaType = (typeof LOCAL_SERVER_IMAGE_MEDIA_TYPES)[number]

/** 開始画像 1 枚の上限（契約。base64 を戻した大きさ）。 */
export const LOCAL_SERVER_MAX_IMAGE_BYTES = 20 * 1024 * 1024

export type LocalServerImage = {
  readonly data: string
  readonly media_type: LocalServerImageMediaType
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

export const localServerInputError = (
  identity: LocalServerIdentity,
  message: string,
): ProviderError => new ProviderError(message, identity.providerId, false)

/**
 * どのサーバでも同じ入力の検査（プロンプトの有無と長さ・seed の符号）。
 * **画像を取り寄せる前に呼ぶ。** 落ちるなら 20MB を読む前に落とす。
 */
export const ensurePromptAndSeed = (
  identity: LocalServerIdentity,
  spec: ShotGenerationSpec,
): void => {
  const promptChars = [...spec.prompt].length
  if (spec.prompt.trim() === '') throw localServerInputError(identity, 'プロンプトが空です')
  if (promptChars > LOCAL_SERVER_MAX_PROMPT_CHARS) {
    throw localServerInputError(
      identity,
      `プロンプトが ${String(promptChars)} 文字あり、上限 ${String(LOCAL_SERVER_MAX_PROMPT_CHARS)} 文字を超えています`,
    )
  }
  if (spec.seed !== null && spec.seed < 0) {
    throw localServerInputError(identity, 'seed は 0 以上にしてください')
  }
}

/** Content-Type から画像の形式を読む。`image/jpg` は `image/jpeg` の書き癖として受ける。 */
export const imageMediaTypeOf = (contentType: string | null): LocalServerImageMediaType | null => {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  const normalized = base === 'image/jpg' ? 'image/jpeg' : base
  return LOCAL_SERVER_IMAGE_MEDIA_TYPES.find((type) => type === normalized) ?? null
}

const START_IMAGE_UNREADABLE = '最初のフレームの画像を読み込めませんでした'
const TOO_LARGE = '最初のフレームの画像が大きすぎます（20MB まで）'

/**
 * 開始画像を取りに行き、base64 にする。
 *
 * `url` は署名付き URL。**例外にもログにも載せない**（CLAUDE.md 規約 7）。
 * サーバへは URL ではなく中身を送る（サーバからストレージが見えるとは限らないため）。
 */
export const fetchStartImage = async (
  identity: LocalServerIdentity,
  fetch: LocalServerFetch,
  url: string,
  timeoutMs: number,
): Promise<LocalServerImage> => {
  const signal = AbortSignal.timeout(timeoutMs)
  const response = await (async (): Promise<Response> => {
    try {
      return await fetch(url, { method: 'GET', signal })
    } catch (cause) {
      throw new ProviderError(START_IMAGE_UNREADABLE, identity.providerId, true, { cause })
    }
  })()

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const retryable = response.status === 429 || response.status >= 500
    throw new ProviderError(
      `${START_IMAGE_UNREADABLE}（HTTP ${String(response.status)}）`,
      identity.providerId,
      retryable,
    )
  }

  const mediaType = imageMediaTypeOf(response.headers.get('content-type'))
  const body: ReadableStream<Uint8Array> | null = response.body
  // 送れないと分かっている本文は読まない（読み取りを取り消して接続を返す）。
  const reject = async (message: string): Promise<never> => {
    await body?.cancel().catch(() => undefined)
    throw localServerInputError(identity, message)
  }
  if (mediaType === null)
    return reject('最初のフレームの画像は PNG・JPEG・WebP のどれかにしてください')
  if (declaresTooLarge(response.headers, LOCAL_SERVER_MAX_IMAGE_BYTES)) return reject(TOO_LARGE)
  if (body === null) return reject('最初のフレームの画像が空です')

  const bytes = await (async (): Promise<Uint8Array> => {
    try {
      // 丸ごと読んでから確かめない。上限を超えた時点で止める。
      return await readAllWithLimit(body, LOCAL_SERVER_MAX_IMAGE_BYTES)
    } catch (cause) {
      if (cause instanceof BodyTooLargeError) throw localServerInputError(identity, TOO_LARGE)
      throw new ProviderError(START_IMAGE_UNREADABLE, identity.providerId, true, { cause })
    }
  })()

  if (bytes.byteLength === 0)
    throw localServerInputError(identity, '最初のフレームの画像が空です')
  return { data: Buffer.from(bytes).toString('base64'), media_type: mediaType }
}
