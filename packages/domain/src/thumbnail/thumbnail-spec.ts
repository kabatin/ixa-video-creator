import { z } from 'zod'
import { MediaAssetId } from '../common/ids.js'
import { Seconds } from '../common/time.js'
import { TextFont } from '../timeline/text-style.js'

/**
 * YouTube のサムネイルの仕様（ADR-0051）。**画面・API・worker・MCP がこの 1 つを通す。**
 *
 * 背景は 2 つ:
 * - `timeline_frame`: タイムラインのそのコマ（秒。規約 3）。書き出しと同じ TimelineComposition を止めて描く
 * - `image`: 素材の画像 1 枚（Shot の絵・AI に描かせたキーアート）
 *
 * 背景は 1280×720 を覆う大きさにしてから、`zoom` 倍に拡大し、`focusX`/`focusY` の位置へ寄せる。
 * `focus` は背景の中の割合で、0.5 なら真ん中、0 なら左（上）の端を見せる。
 */

/** YouTube の推奨の大きさ。 */
export const THUMBNAIL_SIZE = Object.freeze({ width: 1280, height: 720 })
/** YouTube のサムネイルの上限（2 MB）。**未満**でなければならない。 */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024

export const THUMBNAIL_TITLE_MAX_LENGTH = 40
export const THUMBNAIL_SUBTITLE_MAX_LENGTH = 60
export const THUMBNAIL_ZOOM_MIN = 1
export const THUMBNAIL_ZOOM_MAX = 2

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #RRGGBB の形で指定してください')

export const ThumbnailBackground = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeline_frame'), atSec: Seconds }),
  z.object({ kind: z.literal('image'), mediaAssetId: MediaAssetId }),
])
export type ThumbnailBackground = z.infer<typeof ThumbnailBackground>

/**
 * 文字の置き方。どれも顔の上に文字を重ねにくい形にする。
 * - `left`: 左の 3 分の 1 に文字の塊（人物は右に置く絵向け）
 * - `center`: 真ん中に大きく
 * - `bottom`: 下の帯に題名（人物が上半分にいる絵向け）
 */
export const ThumbnailLayout = z.enum(['left', 'center', 'bottom'])
export type ThumbnailLayout = z.infer<typeof ThumbnailLayout>

const Fraction = z.number().finite().min(0).max(1)

/** 1 字は書記素ではなくコードポイントで数える（絵文字の結合は数え過ぎるが、上限としては安全側）。 */
const charCount = (value: string): number => [...value].length

const Title = z
  .string()
  .trim()
  .refine((value) => charCount(value) >= 1, { message: '題名を入れてください' })
  .refine((value) => charCount(value) <= THUMBNAIL_TITLE_MAX_LENGTH, {
    message: `題名は ${String(THUMBNAIL_TITLE_MAX_LENGTH)} 字までにしてください`,
  })

const Subtitle = z
  .string()
  .trim()
  .refine((value) => charCount(value) <= THUMBNAIL_SUBTITLE_MAX_LENGTH, {
    message: `副題は ${String(THUMBNAIL_SUBTITLE_MAX_LENGTH)} 字までにしてください`,
  })
  // 空の副題は「副題なし」。空文字と null の 2 通りを持たない。
  .transform((value) => (value === '' ? null : value))

export const ThumbnailSpec = z.object({
  background: ThumbnailBackground,
  zoom: z.number().finite().min(THUMBNAIL_ZOOM_MIN).max(THUMBNAIL_ZOOM_MAX).default(1),
  focusX: Fraction.default(0.5),
  focusY: Fraction.default(0.5),
  title: Title,
  subtitle: Subtitle.nullable().default(null),
  layout: ThumbnailLayout.default('left'),
  titleColor: HexColor.default('#ffffff'),
  accentColor: HexColor.default('#ffcc00'),
  font: TextFont.default('gothic'),
})
export type ThumbnailSpec = z.infer<typeof ThumbnailSpec>
/** 省略できる項目を省いた入力（API の本文・MCP の引数）。 */
export type ThumbnailSpecInput = z.input<typeof ThumbnailSpec>
