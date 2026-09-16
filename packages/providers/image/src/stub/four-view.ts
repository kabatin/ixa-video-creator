import { toFfmpegColor } from './color.js'

/**
 * 四面図（ターンアラウンドシート）のプレースホルダ描画（ARCHITECTURE.md §8）。
 *
 * 四面図は「参照枠が 3 枚しかないモデルに、正面・側面・背面・斜めを 1 枚で渡す」ための絵である。
 * したがってスタブでも **1 枚が 4 面に分かれていることが目で分かる**必要がある。
 * 象限ごとに色調を変え、枠線で区切り、中にシルエットのブロックを置く。
 *
 * すべて `drawbox` で描く。`drawbox` は libfreetype に依存しないため、
 * drawtext を持たない FFmpeg ビルドでも同じ絵が出る（ラベルだけが縮退する）。
 */

export const FOUR_VIEW_LABELS = ['front', 'side', 'back', 'three-quarter'] as const
export type FourViewLabel = (typeof FOUR_VIEW_LABELS)[number]

export type Quadrant = {
  readonly index: number
  readonly label: FourViewLabel
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 2x2 に分割する。端数は右下の象限に寄せ、キャンバス全体を隙間なく覆う。 */
export const quadrantsFor = (width: number, height: number): readonly Quadrant[] => {
  const halfWidth = Math.floor(width / 2)
  const halfHeight = Math.floor(height / 2)
  const columns = [
    { x: 0, width: halfWidth },
    { x: halfWidth, width: width - halfWidth },
  ]
  const rows = [
    { y: 0, height: halfHeight },
    { y: halfHeight, height: height - halfHeight },
  ]

  return FOUR_VIEW_LABELS.map((label, index) => {
    const column = columns[index % 2] ?? columns[0]
    const row = rows[Math.floor(index / 2)] ?? rows[0]
    if (column === undefined || row === undefined) {
      throw new Error(`象限 ${index} の座標を決められません（${width}x${height}）`)
    }
    return { index, label, x: column.x, y: row.y, width: column.width, height: row.height }
  })
}

export type FourViewPalette = {
  /** 象限ごとの色調（`#RRGGBB`）。4 要素。 */
  readonly quadrantColors: readonly string[]
  /** 中に置くシルエットの色（`#RRGGBB`）。 */
  readonly figureColor: string
}

const BORDER_COLOR = '0xFFFFFF'
const BORDER_RATIO = 0.004
const MIN_BORDER = 2

export const borderWidthFor = (width: number, height: number): number =>
  Math.max(MIN_BORDER, Math.round(Math.min(width, height) * BORDER_RATIO))

/**
 * 面ごとのシルエットの形。**幅と横位置を変える**ことで、
 * 正面（広い・中央）／側面（細い・やや右）／背面（広い・中央）／斜め（中くらい・中間）を模す。
 */
const FIGURE_SHAPE: readonly { readonly bodyWidthRatio: number; readonly offsetRatio: number }[] = [
  { bodyWidthRatio: 0.26, offsetRatio: 0 },
  { bodyWidthRatio: 0.14, offsetRatio: 0.05 },
  { bodyWidthRatio: 0.26, offsetRatio: 0 },
  { bodyWidthRatio: 0.2, offsetRatio: 0.03 },
]

const HEAD_RATIO = 0.13
const HEAD_TOP_RATIO = 0.2
const BODY_TOP_RATIO = 0.36
const BODY_HEIGHT_RATIO = 0.42

const box = (
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  thickness: string,
): string => `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=${color}:t=${thickness}`

/** 象限 1 つ分の描画（塗り → シルエット → 枠線）。 */
export const buildQuadrantFilters = (
  quadrant: Quadrant,
  palette: FourViewPalette,
  border: number,
): readonly string[] => {
  const fillColor = palette.quadrantColors[quadrant.index] ?? palette.quadrantColors[0]
  const shape = FIGURE_SHAPE[quadrant.index] ?? FIGURE_SHAPE[0]
  if (fillColor === undefined || shape === undefined) {
    throw new Error(`象限 ${quadrant.index} の配色を決められません`)
  }

  const figureColor = toFfmpegColor(palette.figureColor)
  const centerX = quadrant.x + Math.round(quadrant.width / 2 + quadrant.width * shape.offsetRatio)
  const bodyWidth = Math.max(2, Math.round(quadrant.width * shape.bodyWidthRatio))
  const bodyHeight = Math.max(2, Math.round(quadrant.height * BODY_HEIGHT_RATIO))
  const headSize = Math.max(2, Math.round(quadrant.height * HEAD_RATIO))

  return [
    box(quadrant.x, quadrant.y, quadrant.width, quadrant.height, toFfmpegColor(fillColor), 'fill'),
    box(
      centerX - Math.round(headSize / 2),
      quadrant.y + Math.round(quadrant.height * HEAD_TOP_RATIO),
      headSize,
      headSize,
      figureColor,
      'fill',
    ),
    box(
      centerX - Math.round(bodyWidth / 2),
      quadrant.y + Math.round(quadrant.height * BODY_TOP_RATIO),
      bodyWidth,
      bodyHeight,
      figureColor,
      'fill',
    ),
    box(
      quadrant.x,
      quadrant.y,
      quadrant.width,
      quadrant.height,
      BORDER_COLOR,
      String(border),
    ),
  ]
}

const TICK_WIDTH_RATIO = 0.06
const TICK_HEIGHT_RATIO = 0.02
const TICK_MARGIN_RATIO = 0.06

/**
 * drawtext が無い環境のラベル代替。
 * 象限の左上に **(index + 1) 本**の白いバーを並べる。
 * front=1 本 / side=2 本 / back=3 本 / three-quarter=4 本 で、どの面かを数えて判別できる。
 */
export const buildQuadrantTicks = (quadrant: Quadrant): readonly string[] => {
  const tickWidth = Math.max(2, Math.round(quadrant.width * TICK_WIDTH_RATIO))
  const tickHeight = Math.max(2, Math.round(quadrant.height * TICK_HEIGHT_RATIO))
  const margin = Math.round(Math.min(quadrant.width, quadrant.height) * TICK_MARGIN_RATIO)

  return Array.from({ length: quadrant.index + 1 }, (_, tick) =>
    box(
      quadrant.x + margin,
      quadrant.y + margin + tick * tickHeight * 2,
      tickWidth,
      tickHeight,
      BORDER_COLOR,
      'fill',
    ),
  )
}
