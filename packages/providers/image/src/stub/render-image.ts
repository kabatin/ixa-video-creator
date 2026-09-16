import { runFfmpeg, type RunOptions } from '@ixa/media'
import { z } from 'zod'
import { toFfmpegColor } from './color.js'
import { escapeDrawtextText } from './escape.js'
import { detectDrawtextSupport } from './ffmpeg-features.js'
import {
  borderWidthFor,
  buildQuadrantFilters,
  buildQuadrantTicks,
  quadrantsFor,
  type FourViewPalette,
} from './four-view.js'

/**
 * FFmpeg でプレースホルダ画像を作る（ADR-0014 の方針を画像へ広げたもの）。
 * 四面図の構造とプロンプトの違いが目で分かることが目的で、絵の綺麗さは目的ではない。
 *
 * `drawtext` を持たない FFmpeg ビルドもあるため、ラベルを焼けない環境では
 * `drawbox` のティックマークへ**縮退**する（例外にしない）。縮退したかは戻り値で分かる。
 */

const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

/** 何を描くか。四面図（2x2 の面割り）か、単色背景 + 署名バーか。 */
export const ImagePlaceholderMode = z.enum(['four_view', 'plain'])
export type ImagePlaceholderMode = z.infer<typeof ImagePlaceholderMode>

export const ImagePlaceholderInput = z.object({
  outputPath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mode: ImagePlaceholderMode,
  /** `#RRGGBB` 形式のみ受け付ける。名前付き色を混ぜると色の決定性が壊れるため。 */
  backgroundColor: HexColor,
  /** 象限ごとの色調。plain モードでは署名バーの色として使う。 */
  quadrantColors: z.array(HexColor).length(4),
  figureColor: HexColor,
  /** 画面に残す署名。プロンプトのハッシュを想定。 */
  signature: z.string().min(1),
  seed: z.number().int().nullable(),
})
export type ImagePlaceholderInput = {
  outputPath: string
  width: number
  height: number
  mode: ImagePlaceholderMode
  backgroundColor: string
  quadrantColors: readonly string[]
  figureColor: string
  signature: string
  seed: number | null
}

/** ラベルを焼けたか、ティックマークへ縮退したか。 */
export type ImageRenderMode = 'text' | 'degraded_no_drawtext'

export type ImageRenderResult = {
  readonly mode: ImageRenderMode
  readonly outputPath: string
}

export type RenderImageOptions = RunOptions & {
  /** 判定を差し込むためのフック。未指定なら実 ffmpeg の `-filters` で自動判定する。 */
  drawtextAvailable?: boolean
}

/** 環境によっては FFmpeg 既定のフォント解決に失敗するため、env で上書きできるようにする。 */
export const STUB_IMAGE_FONT_FILE_ENV = 'STUB_IMAGE_FONT_FILE'

const LABEL_FONT_RATIO = 0.07
const MIN_FONT_SIZE = 10
const LABEL_MARGIN_RATIO = 0.06
const SIGNATURE_BAR_HEIGHT_RATIO = 0.08
const SIGNATURE_BAR_BOTTOM_RATIO = 0.12
const INT32_MAX = 2147483647

const fontFileOption = (): string => {
  const fontFile = process.env[STUB_IMAGE_FONT_FILE_ENV]
  if (fontFile === undefined || fontFile.length === 0) return ''
  return `fontfile=${escapeDrawtextText(fontFile)}:`
}

type DrawtextParams = {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly fontSize: number
}

const drawtext = ({ text, x, y, fontSize }: DrawtextParams): string =>
  [
    'drawtext=',
    fontFileOption(),
    `text=${escapeDrawtextText(text)}:`,
    `fontsize=${fontSize}:`,
    'fontcolor=white:',
    `borderw=${Math.max(1, Math.round(fontSize * 0.08))}:`,
    'bordercolor=black:',
    `x=${x}:y=${y}`,
  ].join('')

/** seed からノイズ強度を決める。同じ要求から複数枚出すとき、絵を互いに変えるために使う。 */
export const noiseFilterFor = (seed: number): string => {
  const normalized = Math.abs(Math.trunc(seed)) % INT32_MAX
  const strength = 6 + (normalized % 13)
  return `noise=all_seed=${normalized}:all_strength=${strength}:all_flags=t+u`
}

const paletteOf = (input: ImagePlaceholderInput): FourViewPalette => ({
  quadrantColors: input.quadrantColors,
  figureColor: input.figureColor,
})

/** 四面図モードの描画。象限の塗り・シルエット・枠線に、ラベル（またはティック）を重ねる。 */
const fourViewOverlays = (
  input: ImagePlaceholderInput,
  drawtextAvailable: boolean,
): readonly string[] => {
  const quadrants = quadrantsFor(input.width, input.height)
  const border = borderWidthFor(input.width, input.height)
  const palette = paletteOf(input)

  return quadrants.flatMap((quadrant) => {
    const blocks = buildQuadrantFilters(quadrant, palette, border)
    if (!drawtextAvailable) return [...blocks, ...buildQuadrantTicks(quadrant)]

    const fontSize = Math.max(
      MIN_FONT_SIZE,
      Math.round(Math.min(quadrant.width, quadrant.height) * LABEL_FONT_RATIO),
    )
    const margin = Math.round(Math.min(quadrant.width, quadrant.height) * LABEL_MARGIN_RATIO)
    return [
      ...blocks,
      drawtext({
        text: quadrant.label,
        x: quadrant.x + margin,
        y: quadrant.y + margin,
        fontSize,
      }),
    ]
  })
}

/** 通常モードの描画。単色背景に、プロンプトから決まる署名バーを置く。 */
const plainOverlays = (
  input: ImagePlaceholderInput,
  drawtextAvailable: boolean,
): readonly string[] => {
  const barHeight = Math.max(2, Math.round(input.height * SIGNATURE_BAR_HEIGHT_RATIO))
  const top = input.height - Math.round(input.height * SIGNATURE_BAR_BOTTOM_RATIO) - barHeight
  const slot = Math.max(2, Math.floor(input.width / (input.quadrantColors.length * 2 + 1)))

  const bars = input.quadrantColors.map((color, index) => {
    const x = slot + index * slot * 2
    return `drawbox=x=${x}:y=${top}:w=${slot}:h=${barHeight}:color=${toFfmpegColor(color)}:t=fill`
  })

  if (!drawtextAvailable) return bars

  const fontSize = Math.max(MIN_FONT_SIZE, Math.round(input.height * 0.05))
  return [
    ...bars,
    drawtext({ text: input.signature, x: slot, y: top + barHeight + fontSize, fontSize }),
  ]
}

/** 焼き込み内容から filtergraph を組み立てる純粋関数。子プロセスを起動しない。 */
export const buildImageFilters = (
  input: ImagePlaceholderInput,
  drawtextAvailable: boolean,
): string => {
  const overlays =
    input.mode === 'four_view'
      ? fourViewOverlays(input, drawtextAvailable)
      : plainOverlays(input, drawtextAvailable)
  const noise = input.seed === null ? [] : [noiseFilterFor(input.seed)]
  return [...overlays, ...noise].join(',')
}

export const buildImageArgs = (
  input: ImagePlaceholderInput,
  drawtextAvailable: boolean,
): readonly string[] => [
  '-y',
  '-f',
  'lavfi',
  '-i',
  `color=c=${input.backgroundColor}:s=${input.width}x${input.height}`,
  '-vf',
  buildImageFilters(input, drawtextAvailable),
  '-frames:v',
  '1',
  '-update',
  '1',
  '-pix_fmt',
  'rgb24',
  input.outputPath,
]

/**
 * プレースホルダ画像を書き出す。
 * 出力先ディレクトリは呼び出し側が用意すること。
 */
export const renderPlaceholderImage = async (
  input: ImagePlaceholderInput,
  options: RenderImageOptions = {},
): Promise<ImageRenderResult> => {
  const { drawtextAvailable, ...runOptions } = options
  const validated = ImagePlaceholderInput.parse(input)
  const canDrawText = drawtextAvailable ?? (await detectDrawtextSupport())
  const args = buildImageArgs(validated, canDrawText)

  try {
    await runFfmpeg(args, runOptions)
  } catch (error) {
    throw new Error(
      `プレースホルダ画像の生成に失敗しました: ${validated.outputPath}（${validated.width}x${validated.height} / ${validated.mode}）`,
      { cause: error },
    )
  }

  return {
    mode: canDrawText ? 'text' : 'degraded_no_drawtext',
    outputPath: validated.outputPath,
  }
}
