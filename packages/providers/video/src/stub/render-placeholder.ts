import { runFfmpeg, type RunOptions } from '@ixa/media'
import { z } from 'zod'
import { escapeDrawtextExpression, escapeDrawtextText } from './escape.js'
import { detectDrawtextSupport } from './ffmpeg-features.js'
import { buildFrameTicker, buildProgressSegments, buildSignatureBars } from './signature-bars.js'

/**
 * FFmpeg でプレースホルダ動画を作る（ADR-0014）。
 * Shot の内容・尺・フレーム番号が目で分かることが目的で、絵の綺麗さは目的ではない。
 *
 * `drawtext` を持たない FFmpeg ビルドもあるため、テキストが焼けない環境では
 * カラーバーとプログレスバーへ**縮退**する（例外にしない）。縮退したかは戻り値で分かる。
 */
export const PlaceholderInput = z.object({
  outputPath: z.string().min(1),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  /** `#RRGGBB` 形式のみ受け付ける。名前付き色を混ぜると色の決定性が壊れるため。 */
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  /** 画面に焼き込むテキスト。多すぎると読めないので 6 行までに制限する。 */
  lines: z.array(z.string()).max(6),
  /** 縮退時のカラーバーを決める署名。specHash を想定。 */
  signature: z.string().min(1),
  seed: z.number().int().nullable(),
})
export type PlaceholderInput = {
  outputPath: string
  durationSec: number
  width: number
  height: number
  fps: number
  backgroundColor: string
  lines: readonly string[]
  signature: string
  seed: number | null
}

/** テキストを焼けたか、カラーバーへ縮退したか。 */
export type PlaceholderRenderMode = 'text' | 'degraded_no_drawtext'

export type PlaceholderRenderResult = {
  readonly mode: PlaceholderRenderMode
  readonly outputPath: string
}

export type RenderPlaceholderOptions = RunOptions & {
  /** 判定を差し込むためのフック。未指定なら実 ffmpeg の `-filters` で自動判定する。 */
  drawtextAvailable?: boolean
}

/** 環境によっては FFmpeg 既定のフォント解決に失敗するため、env で上書きできるようにする。 */
export const STUB_FONT_FILE_ENV = 'STUB_FONT_FILE'

const FONT_SIZE_RATIO = 0.04
const LINE_HEIGHT_RATIO = 1.35
const BORDER_RATIO = 0.005
const MIN_FONT_SIZE = 10
const INT32_MAX = 2147483647

type TextStyle = {
  readonly fontSize: number
  readonly borderWidth: number
  readonly margin: number
  readonly lineHeight: number
}

export const textStyleFor = (height: number): TextStyle => {
  const fontSize = Math.max(MIN_FONT_SIZE, Math.round(height * FONT_SIZE_RATIO))
  return {
    fontSize,
    borderWidth: Math.max(1, Math.round(fontSize * BORDER_RATIO * 10)),
    margin: fontSize,
    lineHeight: Math.round(fontSize * LINE_HEIGHT_RATIO),
  }
}

const fontFileOption = (): string => {
  const fontFile = process.env[STUB_FONT_FILE_ENV]
  if (fontFile === undefined || fontFile.length === 0) return ''
  // パスにコンマや : が含まれても filtergraph が壊れないよう外側 2 段をエスケープする。
  return `fontfile=${escapeDrawtextExpression(fontFile)}:`
}

type DrawtextParams = {
  readonly escapedText: string
  readonly x: number
  readonly y: number
  readonly style: TextStyle
}

const drawtext = ({ escapedText, x, y, style }: DrawtextParams): string =>
  [
    'drawtext=',
    fontFileOption(),
    `text=${escapedText}:`,
    `fontsize=${style.fontSize}:`,
    'fontcolor=white:',
    `borderw=${style.borderWidth}:`,
    'bordercolor=black:',
    `x=${x}:y=${y}`,
  ].join('')

/** seed からノイズ強度を決める。Take ごとに絵が変わり、切り替えが目で分かるようにするため。 */
export const noiseFilterFor = (seed: number): string => {
  const normalized = Math.abs(Math.trunc(seed)) % INT32_MAX
  const strength = 4 + (normalized % 9)
  return `noise=all_seed=${normalized}:all_strength=${strength}:all_flags=t+u`
}

/** drawtext がある環境の描画。画面下部のタイムコードで音ズレとフレーム落ちが分かる。 */
const textOverlays = (input: PlaceholderInput): readonly string[] => {
  const style = textStyleFor(input.height)

  const lines = input.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, index }) =>
      drawtext({
        escapedText: escapeDrawtextText(line),
        x: style.margin,
        y: style.margin + index * style.lineHeight,
        style,
      }),
    )

  const timecode = drawtext({
    escapedText: escapeDrawtextExpression('%{pts:hms} | frame %{n}'),
    x: style.margin,
    y: input.height - style.margin - style.fontSize,
    style,
  })

  return [...lines, timecode]
}

/** drawtext が無い環境の描画。署名から決まるカラーバーと、時間で伸びるプログレスバー。 */
const degradedOverlays = (input: PlaceholderInput): readonly string[] => [
  buildSignatureBars(input.signature, input.width, input.height),
  buildProgressSegments(input.durationSec, input.width, input.height),
  buildFrameTicker(input.fps, input.width, input.height),
]

/** 焼き込み内容から filtergraph を組み立てる純粋関数。子プロセスを起動しない。 */
export const buildPlaceholderFilters = (
  input: PlaceholderInput,
  drawtextAvailable: boolean,
): string => {
  const overlays = drawtextAvailable ? textOverlays(input) : degradedOverlays(input)
  const noise = input.seed === null ? [] : [noiseFilterFor(input.seed)]
  return [...overlays, ...noise].join(',')
}

/** 尺と fps から出力フレーム数を決める。尺を正確に守るため -frames:v で固定する。 */
export const frameCountFor = (durationSec: number, fps: number): number =>
  Math.max(1, Math.round(durationSec * fps))

export const buildPlaceholderArgs = (
  input: PlaceholderInput,
  drawtextAvailable: boolean,
): readonly string[] => [
  '-y',
  '-f',
  'lavfi',
  '-i',
  `color=c=${input.backgroundColor}:s=${input.width}x${input.height}:r=${input.fps}:d=${input.durationSec}`,
  '-vf',
  buildPlaceholderFilters(input, drawtextAvailable),
  '-frames:v',
  String(frameCountFor(input.durationSec, input.fps)),
  '-r',
  String(input.fps),
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '-an',
  input.outputPath,
]

/**
 * プレースホルダ動画を書き出す。
 * 出力先ディレクトリは呼び出し側が用意すること。
 */
export const renderPlaceholder = async (
  input: PlaceholderInput,
  options: RenderPlaceholderOptions = {},
): Promise<PlaceholderRenderResult> => {
  const { drawtextAvailable, ...runOptions } = options
  const validated = PlaceholderInput.parse(input)
  const canDrawText = drawtextAvailable ?? (await detectDrawtextSupport())
  const args = buildPlaceholderArgs(validated, canDrawText)

  try {
    await runFfmpeg(args, runOptions)
  } catch (error) {
    throw new Error(
      `プレースホルダ動画の生成に失敗しました: ${validated.outputPath}（${validated.width}x${validated.height} ${validated.durationSec}s @ ${validated.fps}fps）`,
      { cause: error },
    )
  }

  return {
    mode: canDrawText ? 'text' : 'degraded_no_drawtext',
    outputPath: validated.outputPath,
  }
}
