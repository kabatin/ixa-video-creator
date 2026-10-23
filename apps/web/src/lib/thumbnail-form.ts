import {
  THUMBNAIL_LAYOUTS,
  ThumbnailSpec,
  type Shot,
  type ShotId,
  type TextFont,
  type ThumbnailBackground,
  type ThumbnailLayout,
} from '@ixa/domain'
import type { ShotPosterMap } from '@/lib/shot-posters'

/**
 * サムネイルの書き出し画面の入力（ADR-0051）。**部品は表示だけ**にし、判定と言い換えはここに置く。
 * 検査は domain の `ThumbnailSpec` が正。ここで上限を書き写さない（L-016）。
 */

export type ThumbnailForm = {
  /** null は「まだ選んでいない」。 */
  readonly background: ThumbnailBackground | null
  readonly zoom: number
  readonly focusX: number
  readonly focusY: number
  readonly title: string
  readonly subtitle: string
  readonly layout: ThumbnailLayout
  /** null は自動（入る中でいちばん大きく）。 */
  readonly titleSize: number | null
  readonly subtitleSize: number | null
  readonly titleColor: string
  readonly subtitleColor: string
  readonly accentBar: boolean
  readonly accentColor: string
  readonly font: TextFont
}

/** 既定値は domain の既定（題名だけは空）。 */
const DEFAULTS = ThumbnailSpec.parse({ background: { kind: 'timeline_frame', atSec: 0 }, title: '仮' })

export const initialThumbnailForm = (title: string): ThumbnailForm => ({
  background: null,
  zoom: DEFAULTS.zoom,
  focusX: DEFAULTS.focusX,
  focusY: DEFAULTS.focusY,
  title,
  subtitle: '',
  layout: DEFAULTS.layout,
  titleSize: DEFAULTS.titleSize,
  subtitleSize: DEFAULTS.subtitleSize,
  titleColor: DEFAULTS.titleColor,
  subtitleColor: DEFAULTS.subtitleColor,
  accentBar: DEFAULTS.accentBar,
  accentColor: DEFAULTS.accentColor,
  font: DEFAULTS.font,
})

/** 3×3 のマスの名前。並びは domain の `THUMBNAIL_LAYOUTS`（上の段の左から）。 */
export const LAYOUT_LABELS: Readonly<Record<ThumbnailLayout, string>> = {
  top_left: '左上',
  top_center: '上',
  top_right: '右上',
  middle_left: '左',
  middle_center: '真ん中',
  middle_right: '右',
  bottom_left: '左下',
  bottom_center: '下',
  bottom_right: '右下',
}

/** マスの縦・横の位置（0〜2）。配置の図に使う。 */
export const layoutCell = (layout: ThumbnailLayout): { readonly row: number; readonly column: number } => {
  const index = THUMBNAIL_LAYOUTS.indexOf(layout)
  return { row: Math.floor(index / 3), column: index % 3 }
}

export const FONT_LABELS: Readonly<Record<TextFont, string>> = {
  gothic: 'ゴシック',
  mincho: '明朝',
  rounded: '丸ゴシック',
}

export const NO_BACKGROUND_MESSAGE = '背景を選んでください'

export type FormCheck =
  | { readonly ok: true; readonly spec: ThumbnailSpec }
  | { readonly ok: false; readonly messages: readonly string[] }

/** 送る前の検査。破れていれば domain の文をそのまま並べる（重複は 1 つに）。 */
export const checkThumbnailForm = (form: ThumbnailForm): FormCheck => {
  if (form.background === null) return { ok: false, messages: [NO_BACKGROUND_MESSAGE] }
  const parsed = ThumbnailSpec.safeParse({ ...form, background: form.background })
  if (parsed.success) return { ok: true, spec: parsed.data }
  return { ok: false, messages: [...new Set(parsed.error.issues.map((issue) => issue.message))] }
}

/**
 * プレビューに使う仕様。**打っている途中の文字もそのまま見せる**（題名が空・長すぎても背景と配置は見える）。
 * 文字以外が破れているか背景が無ければ null（プレビューは理由を出す）。書き出しは `checkThumbnailForm` だけが通す。
 */
export const previewSpec = (form: ThumbnailForm): ThumbnailSpec | null => {
  if (form.background === null) return null
  const parsed = ThumbnailSpec.safeParse({ ...form, background: form.background, title: '題', subtitle: '' })
  if (!parsed.success) return null
  const subtitle = form.subtitle.trim()
  return { ...parsed.data, title: form.title.trim(), subtitle: subtitle === '' ? null : subtitle }
}

/** 「Shot の絵」で選べる 1 枠。採用 Take があれば動画のそのコマ、無ければ最初のフレームの画像。 */
export type ShotPictureChoice = {
  readonly shotId: ShotId
  readonly code: string
  readonly kind: 'take' | 'start_frame'
  /**
   * 採用 Take のとき、タイムラインのどこを止めて描くか（Shot の真ん中）。
   * 頭だと前の Shot からのディゾルブに掛かり、2 つの絵が重なったコマになる。
   */
  readonly atSec: number
  readonly posterUrl: string | null
}

export const shotPictureChoices = (shots: readonly Shot[], posters: ShotPosterMap): readonly ShotPictureChoice[] =>
  [...shots]
    .sort((a, b) => a.startSec - b.startSec)
    .flatMap((shot): ShotPictureChoice[] => {
      const poster = posters.get(shot.id)
      const base = { shotId: shot.id, code: shot.code, atSec: shot.startSec + shot.durationSec / 2, posterUrl: poster?.url ?? null }
      if (shot.selectedTakeId !== null) return [{ ...base, kind: 'take' }]
      if (poster?.hasStartFrame === true) return [{ ...base, kind: 'start_frame' }]
      return []
    })

/** 範囲 [0, 1] へ丸める（スライダーの値の受け口）。 */
export const clampFraction = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5)
