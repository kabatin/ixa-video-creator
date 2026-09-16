import type { AspectRatio, Resolution } from '@ixa/domain'

export type ResolutionPreset = {
  readonly key: string
  readonly label: string
  readonly resolution: Resolution
}

const preset = (width: number, height: number, label: string): ResolutionPreset => ({
  key: `${String(width)}x${String(height)}`,
  label: `${label} (${String(width)}×${String(height)})`,
  resolution: { width, height },
})

const PRESETS: Readonly<Record<AspectRatio, readonly ResolutionPreset[]>> = {
  '16:9': [preset(1920, 1080, 'FHD'), preset(1280, 720, 'HD'), preset(3840, 2160, '4K')],
  '9:16': [preset(1080, 1920, 'FHD 縦'), preset(720, 1280, 'HD 縦')],
  '1:1': [preset(1080, 1080, '正方形 大'), preset(720, 720, '正方形 小')],
  '4:5': [preset(1080, 1350, 'SNS 縦'), preset(864, 1080, 'SNS 縦 小')],
  '21:9': [preset(2560, 1080, 'シネスコ'), preset(3440, 1440, 'シネスコ 大')],
}

export const ASPECT_RATIOS: readonly AspectRatio[] = ['16:9', '9:16', '1:1', '4:5', '21:9']

export const FPS_OPTIONS: readonly number[] = [24, 25, 30, 60]

export const resolutionPresetsFor = (aspectRatio: AspectRatio): readonly ResolutionPreset[] =>
  PRESETS[aspectRatio]

export const defaultResolutionKeyFor = (aspectRatio: AspectRatio): string => {
  const first = PRESETS[aspectRatio][0]
  if (first === undefined) {
    throw new Error(`解像度プリセットが定義されていません: ${aspectRatio}`)
  }
  return first.key
}

export const findResolution = (
  aspectRatio: AspectRatio,
  key: string,
): Resolution | undefined => PRESETS[aspectRatio].find((p) => p.key === key)?.resolution

export const formatResolution = (resolution: Resolution): string =>
  `${String(resolution.width)}×${String(resolution.height)}`
