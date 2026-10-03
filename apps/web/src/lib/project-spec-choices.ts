import type { AspectRatio, Resolution } from '@ixa/domain'
import { ASPECT_RATIOS, FPS_OPTIONS, resolutionPresetsFor } from '@/lib/resolution-presets'

/**
 * 新規作成・設定で選ぶ「形・大きさ・fps」の言葉と図の材料（制作者 2026-10-03「アスペクト比は数字「16:9」を見ても、
 * これって縦だっけ？横だっけ？みたいになる。実際のサイズ図を選ぶ形がよさそう」「解像度もサイズ図的なものを」）。
 * **React を含まない純粋な関数。** 値の集合の正は `resolution-presets.ts`（とドメインの enum）。ここは言葉と図を添えるだけ。
 */

export type AspectChoice = {
  readonly value: AspectRatio
  readonly name: string
  readonly hint: string
  /** 図の縦横（比だけ）。 */
  readonly width: number
  readonly height: number
}

const ASPECT_WORDS: Readonly<Record<AspectRatio, { readonly name: string; readonly hint: string }>> = {
  '16:9': { name: '横長', hint: 'YouTube・テレビ' },
  '9:16': { name: '縦長', hint: 'ショート動画・リール' },
  '1:1': { name: '正方形', hint: 'SNS の投稿' },
  '4:5': { name: 'やや縦長', hint: 'SNS のフィード' },
  '21:9': { name: 'シネスコ', hint: '映画のような横長' },
}

const ratioOf = (value: AspectRatio): { readonly width: number; readonly height: number } => {
  const [width, height] = value.split(':').map(Number)
  return { width: width ?? 1, height: height ?? 1 }
}

export const ASPECT_CHOICES: readonly AspectChoice[] = ASPECT_RATIOS.map((value) => ({
  value,
  ...ASPECT_WORDS[value],
  ...ratioOf(value),
}))

export type ResolutionChoice = {
  readonly key: string
  readonly name: string
  /** `1920×1080`。 */
  readonly size: string
  readonly hint: string
  readonly resolution: Resolution
  /** 図の大きさ（その形でいちばん大きいものに対する横幅の割合）。 */
  readonly scale: number
}

const pixels = (resolution: Resolution): number => resolution.width * resolution.height

/** 既定（先頭）を「標準」とし、ほかはそれより大きいか小さいかで言う。 */
export const resolutionChoicesFor = (aspectRatio: AspectRatio): readonly ResolutionChoice[] => {
  const presets = resolutionPresetsFor(aspectRatio)
  const standard = presets[0]
  const widest = Math.max(...presets.map((preset) => preset.resolution.width))
  return presets.map((preset) => ({
    key: preset.key,
    name: preset.name,
    size: `${String(preset.resolution.width)}×${String(preset.resolution.height)}`,
    hint:
      standard === undefined || preset.key === standard.key
        ? '標準（迷ったらこれ）'
        : pixels(preset.resolution) > pixels(standard.resolution)
          ? '細かい（書き出しに時間がかかる）'
          : '軽い（確認や試作に）',
    resolution: preset.resolution,
    scale: preset.resolution.width / widest,
  }))
}

const FPS_HINTS: Readonly<Record<number, string>> = {
  24: '映画のような動き',
  25: 'ヨーロッパのテレビの標準',
  30: '標準（迷ったらこれ）',
  60: 'なめらか（速い動き向き）',
}

export const FPS_CHOICES: readonly { readonly value: number; readonly hint: string }[] = FPS_OPTIONS.map((value) => ({
  value,
  hint: FPS_HINTS[value] ?? '',
}))

/**
 * 選んでいる動画の AI（「使う AI」の動画の欄。値はそのまま Provider の ID）のモデルが作れる fps。重ねず小さい順。
 * そのモデルが一覧に無ければ null（分からない。合わせる案内を出さない）。
 */
export const videoFpsFor = (
  models: readonly { readonly providerId: string; readonly fps: readonly number[] }[],
  providerId: string,
): readonly number[] | null => {
  const mine = models.filter((model) => model.providerId === providerId)
  if (mine.length === 0) return null
  return [...new Set(mine.flatMap((model) => model.fps))].sort((a, b) => a - b)
}

/** `横長 16:9 ・ FHD ・ 30 fps`。プロジェクト一覧のカードに出す。選択肢に無い大きさは縦横の数で言う。 */
export const describeProjectSpec = (project: {
  readonly aspectRatio: AspectRatio
  readonly resolution: Resolution
  readonly fps: number
}): string => {
  const aspect = ASPECT_CHOICES.find((choice) => choice.value === project.aspectRatio)
  const size = resolutionChoicesFor(project.aspectRatio).find(
    (choice) =>
      choice.resolution.width === project.resolution.width && choice.resolution.height === project.resolution.height,
  )
  return [
    aspect === undefined ? project.aspectRatio : `${aspect.name} ${aspect.value}`,
    size?.name ?? `${String(project.resolution.width)}×${String(project.resolution.height)}`,
    `${String(project.fps)} fps`,
  ].join(' ・ ')
}
