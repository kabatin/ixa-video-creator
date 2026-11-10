import { z } from 'zod'
import { MediaAssetId } from '../common/ids.js'
import { MediaKind, MediaProbe } from '../media/media-asset.js'
import { PROJECT_NAME_MAX_LENGTH, ProjectDemoKey } from './project.js'

/**
 * 同梱の見本の作品の目録（ADR-0067）。目録（`manifest.json`）は git に置き、ファイルはリリースに置く。
 *
 * - `media` … 素材（MediaAsset）になるファイル。`id` は `source` の中でその素材を指す ID
 * - `files` … 行がストレージの置き場で指すほかのもの（曲の解析の波形）
 * - `source` … 作品の複製が読む形（`DuplicationSource`）を JSON にしたもの。**ここでは JSON のまま持つ**
 *   （domain の型へ戻すのは API。素材の ID を付け替えてから読む）
 *
 * 入れる側は、ファイルの名前と置き場を**この形で縛ってから**使う（目録の外の場所を読ませない・書かせない）。
 */

export const DEMO_MANIFEST_FORMAT_VERSION = 1

/** 1 つのファイルの大きさの上限（バイト）。見本は 1 本数 MB。入れる側はこれを丸ごと読み込む。 */
export const MAX_DEMO_FILE_BYTES = 200 * 1024 * 1024

/** ファイル名: 英数字で始まり、`/`・`..`・空白を含まない（取りに行く先・読む場所の外へ出さない）。 */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9]+)?$/
/** 置き場の 1 区間（`packages/storage` の区間の規則に、最後の区間の拡張子を足したもの）。 */
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/
/** 目録の `files` が書いてよい置き場の頭。いまは曲の解析の波形（`music/{projectId}/{trackId}/peaks.json`）だけ。 */
export const DEMO_FILE_KEY_PREFIXES = ['music'] as const

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i

export const DemoFileName = z.string().min(1).max(128).regex(SAFE_FILE_NAME, 'ファイル名に使えない文字があります')

export const DemoSha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 は 64 桁の小文字 16 進数です')

/** ストレージの置き場。知っている頭の下で、区間はすべて安全な文字だけ（絶対パス・`..`・空の区間を断る）。 */
export const DemoStorageKey = z
  .string()
  .min(1)
  .max(256)
  .refine((key) => {
    const segments = key.split('/')
    const [head] = segments
    return (
      segments.length >= 2 &&
      DEMO_FILE_KEY_PREFIXES.some((prefix) => prefix === head) &&
      segments.every((segment) => SAFE_KEY_SEGMENT.test(segment))
    )
  }, '見本のファイルを置ける場所ではありません')

/** 取りに行く先の頭。https で、末尾が `/`、問い合わせ・断片・利用者名を持たない（署名付きの URL を目録に入れない）。 */
export const DemoBaseUrl = z
  .string()
  .url()
  .refine((value) => {
    // 形の崩れた文字は `.url()` が断る。ここでは読めたものだけを見る（refine は url の失敗の後も走る）。
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      value.endsWith('/') &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    )
  }, '取りに行く先は https で、末尾を / にし、? 以降を付けないでください')

const fileFields = {
  file: DemoFileName,
  sha256: DemoSha256,
  sizeBytes: z.number().int().positive().max(MAX_DEMO_FILE_BYTES),
}

export const DemoMediaEntry = z.object({
  id: MediaAssetId,
  ...fileFields,
  contentType: z.string().min(1).max(255),
  originalFilename: z.string().min(1).max(255),
  kind: MediaKind,
  /** 素材の行に先に入れておく probe（取り込みのジョブが後から測り直す）。 */
  probe: MediaProbe.nullable(),
})
export type DemoMediaEntry = z.infer<typeof DemoMediaEntry>

export const DemoFileEntry = z.object({ key: DemoStorageKey, ...fileFields })
export type DemoFileEntry = z.infer<typeof DemoFileEntry>

/** 取りに行く 1 つのファイル（素材でもほかのものでも同じ確かめ方をする）。 */
export type DemoFileRef = Pick<DemoMediaEntry, 'file' | 'sha256' | 'sizeBytes'>

const duplicatesOf = (values: readonly string[]): readonly string[] =>
  values.filter((value, index) => values.indexOf(value) !== index)

export const DemoManifest = z
  .object({
    formatVersion: z.literal(DEMO_MANIFEST_FORMAT_VERSION),
    demoKey: ProjectDemoKey,
    /** 入れた作品の名前。 */
    title: z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH),
    baseUrl: DemoBaseUrl,
    media: z.array(DemoMediaEntry),
    files: z.array(DemoFileEntry),
    source: z.record(z.unknown()),
  })
  .superRefine((manifest, ctx) => {
    const problems = [
      ...duplicatesOf(manifest.media.map((entry) => entry.id)).map(() => '同じ素材の ID が 2 つあります'),
      ...duplicatesOf(manifest.media.map((entry) => entry.sha256)).map(() => '同じ中身の素材が 2 つあります'),
      ...duplicatesOf([...manifest.media, ...manifest.files].map((entry) => entry.file)).map(() => '同じファイル名が 2 つあります'),
      ...duplicatesOf(manifest.files.map((entry) => entry.key)).map(() => '同じ置き場が 2 つあります'),
    ]
    for (const message of new Set(problems)) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  })
export type DemoManifest = z.infer<typeof DemoManifest>

/** 初めて入れるときに取りに行く大きさ（バイト）。 */
export const demoTotalBytes = (manifest: Pick<DemoManifest, 'media' | 'files'>): number =>
  [...manifest.media, ...manifest.files].reduce((sum, entry) => sum + entry.sizeBytes, 0)

/** JSON の木の文字の値を `fn` で替えた**新しい木**を返す（キーは替えない。元は変えない）。 */
const mapStringValues = (value: unknown, fn: (text: string) => string): unknown => {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((item: unknown) => mapStringValues(item, fn))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStringValues(item, fn)]))
  }
  return value
}

/** JSON の木の文字の値を、すべて集める（キーは数えない）。 */
const stringValues = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item: unknown) => stringValues(item))
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap((item) => stringValues(item))
  return []
}

/**
 * 素材の ID を付け替える。**値がちょうど表の ID と一致するものだけ**を替える（ID は ULID なので、ほかの値には当たらない。
 * 列の名前を並べないので、あとで列が増えても漏れない）。キー・表に無い値・ID を含むだけの文字（置き場など）は替えない。
 */
export const remapExactValues = (value: unknown, map: ReadonlyMap<string, string>): unknown =>
  mapStringValues(value, (text) => map.get(text) ?? text)

/** 値に出てくる ULID（どれが素材かは書き出す側が素材の表で引く）。 */
export const ulidValues = (value: unknown): ReadonlySet<string> =>
  new Set(stringValues(value).filter((text) => ULID.test(text)))

/** `source` が指す素材のうち、`media` に無いもの（書き出す側の点検。入れた先で絵が欠ける）。 */
export const unlistedMediaReferences = (
  manifest: Pick<DemoManifest, 'media' | 'source'>,
  knownMediaIds: ReadonlySet<string>,
): readonly string[] => {
  const listed = new Set<string>(manifest.media.map((entry) => entry.id))
  return [...ulidValues(manifest.source)].filter((id) => knownMediaIds.has(id) && !listed.has(id)).sort()
}

/** 署名・鍵を運ぶ問い合わせの名前（fs の `sig`・`exp`、S3 の `X-Amz-*`、そのほかの `token` など）。 */
const SIGNED_QUERY_NAMES = /[?&](sig|signature|exp|expires|token|access_token|x-amz-[a-z-]+)=/i

/** 署名付きの URL に見える文字か（書き出す目録に入れない）。URL の形で、署名・鍵の問い合わせを持つもの。 */
export const looksLikeSignedUrl = (text: string): boolean => /[a-z]+:\/\//i.test(text) && SIGNED_QUERY_NAMES.test(text)

/** 目録の中の文字の値のうち、署名付きの URL に見えるもの・渡した秘密を含むもの（書き出す側の点検）。 */
export const leakingValues = (value: unknown, secrets: readonly string[]): readonly string[] =>
  stringValues(value).filter(
    (text) => looksLikeSignedUrl(text) || secrets.some((secret) => secret !== '' && text.includes(secret)),
  )
