import {
  MAX_TEXT_FADE_SEC,
  MAX_TEXT_OFFSET,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TextStyle,
  parseTextClipParams,
  type TextAlign,
  type TextAnchor,
  type TextFont,
  type TextShadow,
  type TextTemplateKey,
  type TextWeight,
  type TimelineClipContent,
} from '@ixa/domain'
import { formatDuration } from '@/lib/format-time'

/**
 * テロップの見た目の欄（ADR-0028）。**React を含まない。**
 * 画面の言葉と保存する値（割合）を行き来する。画面には px を出さない（大きさは画面の高さの %）。
 */

type Option<T extends string> = { readonly value: T; readonly label: string }

/** テロップの型の言葉。**ここが唯一の正**（タイムラインの小窓とインスペクターが同じ言葉を使う）。 */
export const TEXT_TEMPLATE_LABELS: Readonly<Record<TextTemplateKey, string>> = {
  plain: 'そのまま（中央）',
  lower_third: '下帯（字幕）',
}

export const FONT_OPTIONS: readonly Option<TextFont>[] = [
  { value: 'gothic', label: 'ゴシック' },
  { value: 'mincho', label: '明朝' },
  { value: 'rounded', label: '丸ゴシック' },
]

export const WEIGHT_OPTIONS: readonly Option<TextWeight>[] = [
  { value: 'regular', label: '普通' },
  { value: 'bold', label: '太字' },
  { value: 'heavy', label: '極太' },
]

export const SHADOW_OPTIONS: readonly Option<TextShadow>[] = [
  { value: 'none', label: 'なし' },
  { value: 'soft', label: '弱い' },
  { value: 'strong', label: '強い' },
]

export const ALIGN_OPTIONS: readonly Option<TextAlign>[] = [
  { value: 'left', label: '左揃え' },
  { value: 'center', label: '中央揃え' },
  { value: 'right', label: '右揃え' },
]

/** 縁取りの太さ（文字の大きさに対する割合）。 */
export const STROKE_WIDTH_OPTIONS = [
  { value: '0.06', label: '細い' },
  { value: '0.12', label: '普通' },
  { value: '0.2', label: '太い' },
] as const

/** 背景の帯の濃さ。 */
export const BACKGROUND_OPACITY_OPTIONS = [0.25, 0.4, 0.55, 0.7, 0.85, 1].map((value) => ({
  value: String(value),
  label: `${String(Math.round(value * 100))}%`,
}))

/** フェードの長さ。書式は尺と同じ（`0.50s`）。 */
export const FADE_OPTIONS = [0, 0.25, 0.5, 1, 1.5, MAX_TEXT_FADE_SEC].map((sec) => ({
  value: String(sec),
  label: sec === 0 ? 'なし' : formatDuration(sec),
}))

const VERTICAL = [
  { key: 'top', label: '上' },
  { key: 'middle', label: '中' },
  { key: 'bottom', label: '下' },
] as const
const HORIZONTAL = [
  { key: 'left', label: '左' },
  { key: 'center', label: '中央' },
  { key: 'right', label: '右' },
] as const

/** 定位置の 3×3。上から下、左から右。 */
export const ANCHOR_GRID: readonly (readonly { readonly anchor: TextAnchor; readonly label: string }[])[] =
  VERTICAL.map((row) =>
    HORIZONTAL.map((column) => ({
      anchor: `${row.key}-${column.key}`,
      label:
        row.key === 'middle'
          ? column.key === 'center'
            ? '中央'
            : `中${column.label}`
          : `${column.label}${row.label}`,
    })),
  )

type Parsed = { readonly ok: true; readonly value: number | null } | { readonly ok: false; readonly reason: string }

const toNumber = (raw: string): number | null => {
  const value = Number(raw.trim().replace(/%$/, ''))
  return Number.isFinite(value) ? value : null
}

const percent = (ratio: number): string => String(Math.round(ratio * 1000) / 10)

/** % を割合へ。小数の割り算の端数を残さない（5.2 → 0.052）。 */
const fromPercent = (value: number): number => Math.round(value * 100) / 10000

/** 大きさ（画面の高さの %）。空欄は自動。 */
export const parseSizePercent = (raw: string): Parsed => {
  if (raw.trim() === '') return { ok: true, value: null }
  const value = toNumber(raw)
  const min = MIN_TEXT_SIZE * 100
  const max = MAX_TEXT_SIZE * 100
  if (value === null || value < min || value > max) {
    return { ok: false, reason: `${String(min)}〜${String(max)} の数で入れてください（空欄は自動）` }
  }
  return { ok: true, value: fromPercent(value) }
}

export const sizePercentLabel = (size: number | null): string => (size === null ? '' : percent(size))

/** ずらし（画面の幅・高さの %）。空欄は 0。 */
export const parseOffsetPercent = (raw: string): Parsed => {
  if (raw.trim() === '') return { ok: true, value: 0 }
  const value = toNumber(raw)
  const limit = MAX_TEXT_OFFSET * 100
  if (value === null || Math.abs(value) > limit) {
    return { ok: false, reason: `-${String(limit)}〜${String(limit)} の数で入れてください` }
  }
  return { ok: true, value: fromPercent(value) }
}

export const offsetPercentLabel = (offset: number): string => percent(offset)

/** テロップの中身。読めない見た目は空（型の既定値）として扱う。文字が読めなければ null。 */
export type ReadableTextParams = {
  readonly text: string
  readonly style: TextStyle
  readonly styleId: string | null
}

export const readTextClipParams = (params: unknown): ReadableTextParams | null => {
  const parsed = parseTextClipParams(params)
  if (parsed === null) return null
  return { text: parsed.text, style: parsed.style ?? {}, styleId: parsed.styleId ?? null }
}

/**
 * 見た目を一部だけ変えた `params`。**文字・どのスタイルからか・他の項目は残す。**
 * `undefined` を渡した項目は消す（型の既定値に戻す）。元の値は変えない。
 */
export const withStyle = (
  params: Record<string, unknown>,
  patch: Partial<Record<keyof TextStyle, unknown>>,
): Record<string, unknown> => {
  const current = TextStyle.safeParse(params.style)
  const merged: Record<string, unknown> = { ...(current.success ? current.data : {}), ...patch }
  const style = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined))
  return { ...params, style }
}

/**
 * 文字だけを直すときの `params`。**既存の見た目・スタイルを残す。**
 * 以前は `{ text }` で丸ごと置き換わり、インスペクターで付けた見た目が消えていた。
 */
export const keepTextParams = (
  existing: TimelineClipContent | null,
  next: Record<string, unknown>,
): Record<string, unknown> =>
  existing !== null && existing.type === 'text' ? { ...existing.params, ...next } : { ...next }
