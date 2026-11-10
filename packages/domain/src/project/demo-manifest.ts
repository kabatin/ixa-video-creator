import { z } from 'zod'
import { MediaAssetId } from '../common/ids.js'
import { MediaProbe } from '../media/media-asset.js'
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
/** 素材の数・ファイルの数・合わせた大きさの上限（入れる側が丸ごと読み込むので、目録の形で縛る）。 */
export const MAX_DEMO_MEDIA = 200
export const MAX_DEMO_FILES = 50
export const MAX_DEMO_TOTAL_BYTES = 500 * 1024 * 1024

/** 取りに行く先の頭に許すホスト（リリースのファイル）。飛ばされた先に許すホストは API が持つ。 */
export const DEMO_BASE_URL_HOST = 'github.com'

/** 見本の素材に許す種類と型（絵・動画・音だけ。HTML・SVG・フォント・LUT などは入れない）。 */
export const DEMO_CONTENT_TYPES = Object.freeze({
  image: ['image/png', 'image/jpeg', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/webm'],
  audio: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/ogg'],
} as const)
export const DemoMediaKind = z.enum(['image', 'video', 'audio'])
export type DemoMediaKind = z.infer<typeof DemoMediaKind>

/** ファイル名: 英数字で始まり、`/`・`..`・空白を含まない（取りに行く先・読む場所の外へ出さない）。 */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9]+)?$/
/** 置き場の 1 区間（`packages/storage` の区間の規則に、最後の区間の拡張子を足したもの）。 */
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/
/** 目録の `files` が書いてよい置き場の頭。いまは曲の解析の波形（`music/{projectId}/{trackId}/peaks.json`）だけ。 */
export const DEMO_FILE_KEY_PREFIXES = ['music'] as const

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

/** 取りに行く先の頭。https の github.com で、末尾が `/`、問い合わせ・断片・利用者名を持たない（署名付きの URL を目録に入れない）。 */
export const DemoBaseUrl = z
  .string()
  .url()
  .refine((value) => {
    // 形の崩れた文字は `.url()` が断る。ここでは読めたものだけを見る（refine は url の失敗の後も走る）。
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === DEMO_BASE_URL_HOST &&
      value.endsWith('/') &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    )
  }, '取りに行く先は https://github.com/ の下で、末尾を / にし、? や # 以降を付けないでください')

const fileFields = {
  file: DemoFileName,
  sha256: DemoSha256,
  sizeBytes: z.number().int().positive().max(MAX_DEMO_FILE_BYTES),
}

export const DemoMediaEntry = z
  .object({
    id: MediaAssetId,
    ...fileFields,
    contentType: z.string().min(1).max(255),
    kind: DemoMediaKind,
    /** 素材の行に先に入れておく probe（取り込みのジョブが後から測り直す）。 */
    probe: MediaProbe.nullable(),
  })
  .refine((entry) => DEMO_CONTENT_TYPES[entry.kind].some((type) => type === entry.contentType), {
    message: '見本の素材にできない型です（絵・動画・音の決まった型だけ）',
    path: ['contentType'],
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
    media: z.array(DemoMediaEntry).max(MAX_DEMO_MEDIA),
    files: z.array(DemoFileEntry).max(MAX_DEMO_FILES),
    source: z.record(z.unknown()),
  })
  .superRefine((manifest, ctx) => {
    const problems = [
      ...duplicatesOf(manifest.media.map((entry) => entry.id)).map(() => '同じ素材の ID が 2 つあります'),
      ...duplicatesOf(manifest.media.map((entry) => entry.sha256)).map(() => '同じ中身の素材が 2 つあります'),
      ...duplicatesOf([...manifest.media, ...manifest.files].map((entry) => entry.file)).map(() => '同じファイル名が 2 つあります'),
      ...duplicatesOf(manifest.files.map((entry) => entry.key)).map(() => '同じ置き場が 2 つあります'),
      ...(demoTotalBytes(manifest) > MAX_DEMO_TOTAL_BYTES ? ['合わせた大きさが上限を超えています'] : []),
    ]
    for (const message of new Set(problems)) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  })
export type DemoManifest = z.infer<typeof DemoManifest>

/** 初めて入れるときに取りに行く大きさ（バイト）。 */
export const demoTotalBytes = (manifest: Pick<DemoManifest, 'media' | 'files'>): number =>
  [...manifest.media, ...manifest.files].reduce((sum, entry) => sum + entry.sizeBytes, 0)
