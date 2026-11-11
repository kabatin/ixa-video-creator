import {
  AspectRatio as AspectRatioSchema,
  PROJECT_FPS_OPTIONS,
  PROJECT_RESOLUTIONS,
  type AspectRatio,
  type Resolution,
} from '@ixa/domain'

export type ResolutionPreset = {
  readonly key: string
  /** 名前（FHD・4K など）。 */
  readonly name: string
  /** 名前と大きさ（`FHD (1920×1080)`）。 */
  readonly label: string
  readonly resolution: Resolution
}

const keyOf = ({ width, height }: Resolution): string => `${String(width)}x${String(height)}`

/**
 * 大きさの名前。**どの大きさを選べるかの正は domain の `PROJECT_RESOLUTIONS`**で、ここは名前を添えるだけ
 * （表を 2 つ持つと、画面で選べる大きさを Take が断る。2026-11-11）。名前の無い大きさは数字だけで出る。
 */
const PRESET_NAMES: Readonly<Record<string, string>> = {
  '1920x1080': 'FHD',
  '1280x720': 'HD',
  '3840x2160': '4K',
  '1080x1920': 'FHD 縦',
  '720x1280': 'HD 縦',
  '1080x1080': '正方形 大',
  '720x720': '正方形 小',
  '1080x1350': 'SNS 縦',
  '864x1080': 'SNS 縦 小',
  '2560x1080': 'シネスコ',
  '3440x1440': 'シネスコ 大',
}

const preset = (resolution: Resolution): ResolutionPreset => {
  const key = keyOf(resolution)
  const size = `${String(resolution.width)}×${String(resolution.height)}`
  const name = PRESET_NAMES[key] ?? size
  return { key, name, label: name === size ? size : `${name} (${size})`, resolution }
}

export const ASPECT_RATIOS: readonly AspectRatio[] = AspectRatioSchema.options

const presetsOf = (aspectRatio: AspectRatio): readonly ResolutionPreset[] =>
  PROJECT_RESOLUTIONS[aspectRatio].map(preset)

const PRESETS: Readonly<Record<AspectRatio, readonly ResolutionPreset[]>> = {
  '16:9': presetsOf('16:9'),
  '9:16': presetsOf('9:16'),
  '1:1': presetsOf('1:1'),
  '4:5': presetsOf('4:5'),
  '21:9': presetsOf('21:9'),
}

export const FPS_OPTIONS: readonly number[] = PROJECT_FPS_OPTIONS

export const resolutionPresetsFor = (aspectRatio: AspectRatio): readonly ResolutionPreset[] =>
  PRESETS[aspectRatio]

export const defaultResolutionKeyFor = (aspectRatio: AspectRatio): string => {
  const first = PRESETS[aspectRatio][0]
  if (first === undefined) {
    throw new Error(`解像度プリセットが定義されていません: ${aspectRatio}`)
  }
  return first.key
}

export const findResolution = (aspectRatio: AspectRatio, key: string): Resolution | undefined =>
  PRESETS[aspectRatio].find((p) => p.key === key)?.resolution

export const formatResolution = (resolution: Resolution): string =>
  `${String(resolution.width)}×${String(resolution.height)}`
