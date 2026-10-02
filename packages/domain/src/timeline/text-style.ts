import { z } from 'zod'
import { ProjectId, TextStyleId } from '../common/ids.js'
import type { TextTemplateKey } from './text-template.js'

/**
 * テロップの見た目（ADR-0028）。
 *
 * **型（plain / lower_third）の既定値に、テロップごとの `style` を重ねる。** どの項目も省略でき、
 * 省略した項目は型の既定値のまま。だから `style` を持たない今までのテロップは同じ絵になる。
 *
 * 大きさ・位置は**割合**で持つ（解像度に依らない。画面に px は出さない）。
 * 書体は端末に入っている和文書体の「まとまり」で指定し、外部フォントは読まない
 * （プレビューと書き出しでフォントの有無が食い違わないよう。描き方は render が持つ）。
 */

export const TextFont = z.enum(['gothic', 'mincho', 'rounded'])
export type TextFont = z.infer<typeof TextFont>

export const TextWeight = z.enum(['regular', 'bold', 'heavy'])
export type TextWeight = z.infer<typeof TextWeight>

export const TextShadow = z.enum(['none', 'soft', 'strong'])
export type TextShadow = z.infer<typeof TextShadow>

export const TextAlign = z.enum(['left', 'center', 'right'])
export type TextAlign = z.infer<typeof TextAlign>

/** 画面の 9 か所。縦（top / middle / bottom）と横（left / center / right）の組。 */
export const TextAnchor = z.enum([
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
])
export type TextAnchor = z.infer<typeof TextAnchor>

/** 文字の大きさ（画面の高さに対する割合）。これより小さいと読めず、大きいと 1 行も入らない。 */
export const MIN_TEXT_SIZE = 0.02
export const MAX_TEXT_SIZE = 0.2
/** 縁取りの太さ（文字の大きさに対する割合）。 */
export const MAX_TEXT_STROKE_WIDTH = 0.25
/** 定位置からのずらし（画面の幅・高さに対する割合）。画面の外へは出さない。 */
export const MAX_TEXT_OFFSET = 0.5
/** フェードの長さ（秒）。 */
export const MAX_TEXT_FADE_SEC = 2

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #RRGGBB の形で指定してください')

export const TextStroke = z.object({
  color: HexColor,
  width: z.number().min(0).max(MAX_TEXT_STROKE_WIDTH),
})
export type TextStroke = z.infer<typeof TextStroke>

export const TextBackground = z.object({
  color: HexColor,
  opacity: z.number().min(0).max(1),
})
export type TextBackground = z.infer<typeof TextBackground>

const Offset = z.number().min(-MAX_TEXT_OFFSET).max(MAX_TEXT_OFFSET)

/**
 * テロップごとの見た目の上書き。**知らない項目は弾く**（書き間違いを黙って捨てない）。
 * `null` は「無し」の指定（例: 下帯の背景を消す）。`size: null` は自動（文字数から決める）。
 */
export const TextStyle = z
  .object({
    font: TextFont.optional(),
    size: z.number().min(MIN_TEXT_SIZE).max(MAX_TEXT_SIZE).nullable().optional(),
    weight: TextWeight.optional(),
    color: HexColor.optional(),
    stroke: TextStroke.nullable().optional(),
    shadow: TextShadow.optional(),
    background: TextBackground.nullable().optional(),
    align: TextAlign.optional(),
    anchor: TextAnchor.optional(),
    offset: z.object({ x: Offset, y: Offset }).optional(),
    fadeInSec: z.number().min(0).max(MAX_TEXT_FADE_SEC).optional(),
    fadeOutSec: z.number().min(0).max(MAX_TEXT_FADE_SEC).optional(),
  })
  .strict()
export type TextStyle = z.infer<typeof TextStyle>

/** 見た目の項目名。まとめて変えるとき「この項目を外す（型の既定に戻す）」の指定に使う。 */
export const TextStyleKey = TextStyle.keyof()
export type TextStyleKey = z.infer<typeof TextStyleKey>

/**
 * 見た目に、変えた項目だけを重ねる（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * `set` の項目を上書きし、`unset` の項目は外す（型の既定に戻す）。ほかの項目はそのまま残す。
 * いまの見た目が読めなければ無しから重ねる（描くときも読めない見た目は既定で描く）。結果は `TextStyle` で確かめ、範囲の外は投げる。
 * 元の見た目は変えない。
 */
export const mergeTextStyle = (
  current: unknown,
  set: TextStyle,
  unset: readonly TextStyleKey[],
): TextStyle => {
  const readable = TextStyle.safeParse(current)
  const merged: Record<string, unknown> = { ...(readable.success ? readable.data : {}), ...set }
  const removed = new Set<string>(unset)
  return TextStyle.parse(Object.fromEntries(Object.entries(merged).filter(([key]) => !removed.has(key))))
}

/** 型の既定値と重ねた、最終の見た目。すべての項目が決まっている。 */
export type ResolvedTextStyle = {
  readonly font: TextFont
  /** null = 自動（文字数と型から決める）。 */
  readonly size: number | null
  readonly weight: TextWeight
  readonly color: string
  readonly stroke: TextStroke | null
  readonly shadow: TextShadow
  readonly background: TextBackground | null
  readonly align: TextAlign
  readonly anchor: TextAnchor
  readonly offset: { readonly x: number; readonly y: number }
  readonly fadeInSec: number
  readonly fadeOutSec: number
}

const COMMON_DEFAULTS = {
  font: 'gothic',
  size: null,
  weight: 'bold',
  color: '#FFFFFF',
  stroke: null,
  offset: { x: 0, y: 0 },
  fadeInSec: 0,
  fadeOutSec: 0,
} as const

/**
 * 型ごとの既定値。**今の見た目と同じ**（`style` の無いテロップの絵を変えない）。
 * - plain: 画面の中央、中央揃え、影あり
 * - lower_third: 下寄せ、左揃え、半透明の黒い帯
 */
export const TEXT_TEMPLATE_STYLE_DEFAULTS: Readonly<Record<TextTemplateKey, ResolvedTextStyle>> =
  Object.freeze({
    plain: {
      ...COMMON_DEFAULTS,
      shadow: 'soft',
      background: null,
      align: 'center',
      anchor: 'middle-center',
    },
    lower_third: {
      ...COMMON_DEFAULTS,
      shadow: 'none',
      background: { color: '#000000', opacity: 0.55 },
      align: 'left',
      anchor: 'bottom-center',
    },
  })

/** 型の既定値に `style` を重ねる。**指定の無い項目だけ既定値**（`null` は「無し」として上書き）。 */
export const resolveTextStyle = (
  template: TextTemplateKey,
  style: TextStyle | undefined,
): ResolvedTextStyle => {
  const base = TEXT_TEMPLATE_STYLE_DEFAULTS[template]
  const overrides = Object.fromEntries(
    Object.entries(style ?? {}).filter(([, value]) => value !== undefined),
  ) as Partial<ResolvedTextStyle>
  return { ...base, ...overrides }
}

/**
 * `params.style` はあるのに読めない（知らない項目・範囲外）。
 * 描く側は見た目だけ捨てて文字は出すので、**検査で知らせる**のに使う。
 */
export const isTextStyleUnreadable = (params: unknown): boolean => {
  if (typeof params !== 'object' || params === null || !('style' in params)) return false
  const { style } = params
  return style !== undefined && !TextStyle.safeParse(style).success
}

/** 名前を付けて保存したスタイル。プロジェクトごと（ADR-0028）。 */
export const MAX_TEXT_STYLE_NAME_LENGTH = 60

export const TextStylePreset = z.object({
  id: TextStyleId,
  projectId: ProjectId,
  name: z.string().trim().min(1).max(MAX_TEXT_STYLE_NAME_LENGTH),
  style: TextStyle,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type TextStylePreset = z.infer<typeof TextStylePreset>

export const CreateTextStylePresetInput = TextStylePreset.pick({ name: true, style: true })
export type CreateTextStylePresetInput = z.input<typeof CreateTextStylePresetInput>

export const UpdateTextStylePresetPatch = CreateTextStylePresetInput.partial()
export type UpdateTextStylePresetPatch = z.input<typeof UpdateTextStylePresetPatch>
