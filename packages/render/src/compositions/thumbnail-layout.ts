import {
  THUMBNAIL_SIZE,
  secondsToFrames,
  type Resolution,
  type ThumbnailLayout,
  type ThumbnailSpec,
  type TimelineDocument,
} from '@ixa/domain'
import { totalFrames } from '../timing.js'
import type { ThumbnailCompositionProps } from './thumbnail-props.js'
import { fitText, type FittedText } from './thumbnail-text-fit.js'

/**
 * サムネイル（ADR-0051）の配置の計算。**純粋な関数だけ。** 画面の Player と worker の renderStill が
 * 同じ Thumbnail コンポジションを通るので、ここが 1 枚の見た目の唯一の正になる。
 */

/** 背景を置く矩形（キャンバスの左上からの px）。 */
export type BackgroundBox = {
  readonly width: number
  readonly height: number
  readonly left: number
  readonly top: number
}

export type Focus = { readonly x: number; readonly y: number }

/**
 * 背景をキャンバスを覆う大きさ（cover）にし、`focus` の位置へ寄せる。
 *
 * `focus` は背景の中の割合。はみ出した分のうち `focus` の割合だけ左（上）へずらすので、
 * CSS の `object-fit: cover` + `object-position: x% y%` と同じ結果になる（画像の背景はそちらで描く）。
 * 幅と高さは偶数に丸める（タイムラインの枠 `letterboxFit` と同じ丸め。1 px の食い違いを作らない）。
 */
export const coverBox = (source: Resolution, canvas: Resolution, focus: Focus): BackgroundBox => {
  const scale = Math.max(canvas.width / source.width, canvas.height / source.height)
  const width = Math.max(canvas.width, Math.round((source.width * scale) / 2) * 2)
  const height = Math.max(canvas.height, Math.round((source.height * scale) / 2) * 2)
  return {
    width,
    height,
    // `0 -` で -0 を作らない（-0 は CSS では同じだが、比べるときに紛らわしい）。
    left: 0 - Math.round((width - canvas.width) * focus.x),
    top: 0 - Math.round((height - canvas.height) * focus.y),
  }
}

/**
 * 拡大（zoom）は覆った後にかける。拡大の中心を `focus` のキャンバス上の点に置くと、
 * その点に写る背景の位置（focus の割合）が拡大しても動かない。覆う計算と寄せの意味が揃う。
 */
export const zoomTransform = (zoom: number, focus: Focus): { readonly transform: string; readonly transformOrigin: string } => ({
  transform: `scale(${String(zoom)})`,
  transformOrigin: `${String(focus.x * 100)}% ${String(focus.y * 100)}%`,
})

/**
 * 止めるコマ。秒 → フレームは `@ixa/domain` の `secondsToFrames`（round）。
 * 画面の「いまの位置」（`program-monitor.ts` の `secToFrame`）と同じ関数なので、見ているコマと同じになる。
 * 尺の外は端のコマに丸める。
 */
export const thumbnailFrameOf = (atSec: number, doc: Pick<TimelineDocument, 'fps' | 'durationSec'>): number => {
  const last = totalFrames(doc.durationSec, doc.fps) - 1
  return Math.min(Math.max(secondsToFrames(atSec, doc.fps), 0), last)
}

/** 画像の背景のときの fps（1 コマしか描かないので何でもよい）。 */
const STILL_FPS = 30

/**
 * コンポジションの大きさ・fps・尺。Root の `calculateMetadata` と画面の Player が**同じこの関数**を使う。
 *
 * タイムラインのコマなら fps と尺をタイムラインに合わせる。中の `<Sequence>` はコンポジションの尺で
 * 切り詰められ、素材の位置はコンポジションの fps で数えられるため、1 コマのコンポジションにすると後ろの Shot が消える。
 * 描くのは常に 0 コマ目で、タイムラインは中で `<Freeze>` する。
 */
export const thumbnailMetadata = (
  props: ThumbnailCompositionProps,
): { readonly fps: number; readonly durationInFrames: number; readonly width: number; readonly height: number } =>
  props.source.kind === 'timeline_frame'
    ? {
        fps: props.source.doc.fps,
        durationInFrames: totalFrames(props.source.doc.durationSec, props.source.doc.fps),
        width: THUMBNAIL_SIZE.width,
        height: THUMBNAIL_SIZE.height,
      }
    : { fps: STILL_FPS, durationInFrames: 1, width: THUMBNAIL_SIZE.width, height: THUMBNAIL_SIZE.height }

/** 文字の塊の置き場所（px）と、題名・副題の最大の大きさ・行数。 */
export type TextBlock = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  /** 塊の中で縦のどこに寄せるか。 */
  readonly vertical: 'start' | 'center' | 'end'
  readonly align: 'left' | 'center' | 'right'
  /**
   * 差し色の置き方。`short` は題名の上の短い線（塊の高さを取る）、
   * `band_top` / `band_bottom` は帯の上端（下端）いっぱいの線（塊の外に引くので高さを取らない）。
   */
  readonly accent: 'short' | 'band_top' | 'band_bottom'
  readonly maxTitleSize: number
  readonly maxTitleLines: number
  readonly maxSubtitleLines: number
}

const { width: W, height: H } = THUMBNAIL_SIZE
const MARGIN = 64

/** 左右の列（左の 3 分の 1）。右は鏡写し。 */
const COLUMN_WIDTH = Math.round(W / 3) + 40 - MARGIN
const column = (side: 'left' | 'right'): TextBlock => ({
  left: side === 'left' ? MARGIN : W - MARGIN - COLUMN_WIDTH,
  top: MARGIN,
  width: COLUMN_WIDTH,
  height: H - MARGIN * 2,
  vertical: 'center',
  align: side,
  accent: 'short',
  maxTitleSize: 120,
  maxTitleLines: 3,
  maxSubtitleLines: 3,
})

/** 上下の横長の帯（高さの約 3 分の 1）。上の帯は下の帯を上下に返した位置。 */
const BAND_HEIGHT = Math.round(H * 0.4) - 40
const BAND_EDGE = H - (Math.round(H * 0.6) + BAND_HEIGHT)
const band = (edge: 'top' | 'bottom', align: TextBlock['align']): TextBlock => ({
  left: MARGIN,
  top: edge === 'bottom' ? Math.round(H * 0.6) : BAND_EDGE,
  width: W - MARGIN * 2,
  height: BAND_HEIGHT,
  vertical: edge === 'bottom' ? 'end' : 'start',
  align,
  accent: edge === 'bottom' ? 'band_top' : 'band_bottom',
  maxTitleSize: 110,
  maxTitleLines: 2,
  maxSubtitleLines: 2,
})

/**
 * 配置ごとの文字の塊（3×3）。どれも顔の上に文字を重ねにくい形にする（ADR-0051）。
 * - middle_left / middle_right: 左（右）の 3 分の 1 の列。人物は反対側の 3 分の 2 に置く絵向け
 * - middle_center: 真ん中に大きく
 * - top_* / bottom_*: 上（下）の帯。横の寄せだけが違う
 * 行数は 3 行まで（それより多いと縮小表示で読めない塊になる）。
 */
export const TEXT_BLOCKS: Readonly<Record<ThumbnailLayout, TextBlock>> = Object.freeze({
  top_left: band('top', 'left'),
  top_center: band('top', 'center'),
  top_right: band('top', 'right'),
  middle_left: column('left'),
  middle_center: {
    left: MARGIN * 2,
    top: MARGIN,
    width: W - MARGIN * 4,
    height: H - MARGIN * 2,
    vertical: 'center',
    align: 'center',
    accent: 'short',
    maxTitleSize: 150,
    maxTitleLines: 2,
    maxSubtitleLines: 2,
  },
  middle_right: column('right'),
  bottom_left: band('bottom', 'left'),
  bottom_center: band('bottom', 'center'),
  bottom_right: band('bottom', 'right'),
})

/** 差し色の線の太さ。題名の大きさに比べる。 */
export const accentThickness = (titleSize: number): number => Math.max(10, Math.round(titleSize * 0.1))

/** 題名の下限。これより小さくすると縮小表示で読めない。40 字の和文を左の列に 3 行で入れられる大きさ。 */
export const MIN_TITLE_SIZE = 28
const MIN_SUBTITLE_SIZE = 20
const SUBTITLE_MAX_SIZE = 48
export const TITLE_LINE_HEIGHT = 1.15
export const SUBTITLE_LINE_HEIGHT = 1.3
/** 題名の縁取り（字の高さの 8%）と影のぶん、行の幅に取っておく割合。 */
const TITLE_STROKE_EM = 0.2
const SUBTITLE_STROKE_EM = 0.1
/** 題名の上の差し色の線と、その下の隙間に取っておく高さ（`short` の線）の下限。 */
const ACCENT_RESERVE = 48

/** 題名と副題の間・差し色の線と題名の間。 */
export const textGap = (titleSize: number): number => Math.round(titleSize * 0.18)

export type FittedThumbnailText = {
  readonly title: FittedText
  readonly subtitle: FittedText | null
}

/** 副題の大きさの上限を題名の何倍までにするか。大きすぎると題名と競る（大きさを決めたときは掛けない）。 */
const SUBTITLE_TO_TITLE = 0.5

const fitSubtitle = (text: string, block: TextBlock, maxSize: number, maxHeight: number): FittedText =>
  fitText(text, {
    width: block.width,
    height: Math.min(maxHeight, Math.ceil(block.maxSubtitleLines * maxSize * SUBTITLE_LINE_HEIGHT)),
    maxLines: block.maxSubtitleLines,
    maxSize,
    minSize: Math.min(maxSize, MIN_SUBTITLE_SIZE),
    lineHeight: SUBTITLE_LINE_HEIGHT,
    strokeEm: SUBTITLE_STROKE_EM,
  })

const heightOf = (fitted: FittedText, lineHeight: number): number => Math.ceil(fitted.lines.length * fitted.size * lineHeight)

/** 塊の中で差し色の線に取る高さ。帯の線・線なしは塊の外（または無い）なので 0。 */
const accentReserve = (block: TextBlock, accentBar: boolean, titleSize: number): number =>
  accentBar && block.accent === 'short' ? Math.max(ACCENT_RESERVE, accentThickness(titleSize) + textGap(titleSize)) : 0

export type ThumbnailTextSpec = Pick<
  ThumbnailSpec,
  'title' | 'subtitle' | 'layout' | 'titleSize' | 'subtitleSize' | 'accentBar'
>

/**
 * 題名と副題の大きさと行（ADR-0051）。**画面の Player と書き出しが同じこの結果で 1 行ずつ描く。**
 *
 * 先に副題を収め（列の幅・行数・題名 1 行ぶんを残した高さ）、残った高さに題名をいちばん大きく収める。
 * 大きさを決めてあれば、それを上限にして入りきらないときだけ縮める（はみ出しは作らない）。
 * 副題の大きさが自動なら、最後に題名の半分を超えていればそこまで縮めて収め直す（縮めるだけなので、題名の場所は足りたまま）。
 */
export const fitThumbnailText = (spec: ThumbnailTextSpec): FittedThumbnailText => {
  const block = TEXT_BLOCKS[spec.layout]
  const maxTitleSize = spec.titleSize ?? block.maxTitleSize
  const accent = accentReserve(block, spec.accentBar, maxTitleSize)
  const subtitleRoom = block.height - accent - textGap(maxTitleSize) - Math.ceil(MIN_TITLE_SIZE * TITLE_LINE_HEIGHT)
  const subtitleMax = spec.subtitleSize ?? SUBTITLE_MAX_SIZE
  const firstSubtitle = spec.subtitle === null ? null : fitSubtitle(spec.subtitle, block, subtitleMax, subtitleRoom)
  const reserve = firstSubtitle === null ? 0 : heightOf(firstSubtitle, SUBTITLE_LINE_HEIGHT) + textGap(maxTitleSize)
  const title = fitText(spec.title, {
    width: block.width,
    height: block.height - accent - reserve,
    maxLines: block.maxTitleLines,
    maxSize: maxTitleSize,
    minSize: Math.min(maxTitleSize, MIN_TITLE_SIZE),
    lineHeight: TITLE_LINE_HEIGHT,
    strokeEm: TITLE_STROKE_EM,
  })
  if (spec.subtitle === null || firstSubtitle === null) return { title, subtitle: null }
  if (spec.subtitleSize !== null) return { title, subtitle: firstSubtitle }
  const cap = Math.round(title.size * SUBTITLE_TO_TITLE)
  const subtitle = firstSubtitle.size <= cap ? firstSubtitle : fitSubtitle(spec.subtitle, block, cap, subtitleRoom)
  return { title, subtitle }
}
