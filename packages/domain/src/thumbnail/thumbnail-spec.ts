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
/** 題名・副題の大きさ（字の高さ）を決めるときの範囲。null は自動（入る中でいちばん大きく）。 */
export const THUMBNAIL_TITLE_SIZE_MIN = 28
export const THUMBNAIL_TITLE_SIZE_MAX = 200
export const THUMBNAIL_SUBTITLE_SIZE_MIN = 20
export const THUMBNAIL_SUBTITLE_SIZE_MAX = 120

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #RRGGBB の形で指定してください')

export const ThumbnailBackground = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeline_frame'), atSec: Seconds }),
  z.object({ kind: z.literal('image'), mediaAssetId: MediaAssetId }),
])
export type ThumbnailBackground = z.infer<typeof ThumbnailBackground>

/**
 * 文字の置き方。3×3 のマスのどこに文字の塊を置くか（縦 top/middle/bottom × 横 left/center/right）。
 * - `middle_left` / `middle_right`: 左（右）の 3 分の 1 の列（人物は反対側に置く絵向け）
 * - `middle_center`: 真ん中に大きく
 * - `top_*` / `bottom_*`: 上（下）の横長の帯。横の寄せだけが違う
 */
export const THUMBNAIL_LAYOUTS = [
  'top_left',
  'top_center',
  'top_right',
  'middle_left',
  'middle_center',
  'middle_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
] as const
export const ThumbnailLayout = z.enum(THUMBNAIL_LAYOUTS)
export type ThumbnailLayout = z.infer<typeof ThumbnailLayout>

/** 3 マスだった頃（ADR-0051 の初版）の値。保存済みの spec と古い API・MCP の入力を読み替える。 */
const LEGACY_LAYOUTS = Object.freeze({ left: 'middle_left', center: 'middle_center', bottom: 'bottom_left' } as const)

/** 配置の入力。今の 9 つに加えて旧値も受け、今の値に直して返す。 */
export const ThumbnailLayoutInput = z.union([
  ThumbnailLayout,
  z.enum(['left', 'center', 'bottom']).transform((legacy): ThumbnailLayout => LEGACY_LAYOUTS[legacy]),
])

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
  layout: ThumbnailLayoutInput.default('middle_left'),
  /** 指定しても、入りきらないときは縮める（はみ出しは作らない）。 */
  titleSize: z.number().int().min(THUMBNAIL_TITLE_SIZE_MIN).max(THUMBNAIL_TITLE_SIZE_MAX).nullable().default(null),
  /** 指定したときは「題名の半分まで」の上限を掛けない。 */
  subtitleSize: z.number().int().min(THUMBNAIL_SUBTITLE_SIZE_MIN).max(THUMBNAIL_SUBTITLE_SIZE_MAX).nullable().default(null),
  titleColor: HexColor.default('#ffffff'),
  subtitleColor: HexColor.default('#ffffff'),
  /** false なら差し色の線も帯も描かない。 */
  accentBar: z.boolean().default(true),
  accentColor: HexColor.default('#ffcc00'),
  font: TextFont.default('gothic'),
})
export type ThumbnailSpec = z.infer<typeof ThumbnailSpec>
/** 省略できる項目を省いた入力（API の本文・MCP の引数）。 */
export type ThumbnailSpecInput = z.input<typeof ThumbnailSpec>
