import { z } from 'zod'

/**
 * エフェクトの型（ADR-0050）。タイムラインの VFX トラックに載る `motion_graphics` クリップの中身。
 *
 * **文から HTML を作らない。** 決まった型を選び、強さなどの値だけを変える。
 * プレビュー（Player）と書き出し（renderMedia）は同じコンポジションを描くので、
 * 型の描画は「コマ番号と値だけで決まる」ことを前提にしている（乱数はクリップの ID から種を取る）。
 *
 * `params` は `Record<string, unknown>` なので、**形の正はここだけが持つ。**
 * 保存（API）・描画（レンダラ）・画面（インスペクタ）・エージェント（MCP）は必ずこのスキーマを通す。
 */

export const EffectTemplateKey = z.enum([
  'flash', 'light_leak', 'speed_lines', 'film_burn', 'glitch', 'title_card', 'shake', 'zoom_punch',
])
export type EffectTemplateKey = z.infer<typeof EffectTemplateKey>

/**
 * `overlay` は下の絵の上に重ねて描く。`frame` は下の絵（VIDEO1・VIDEO2）そのものを動かす（揺らす・寄る）。
 * `frame` の型はクリップの層には何も描かない。
 */
export type EffectKind = 'overlay' | 'frame'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const COLOR_MESSAGE = '色は #RRGGBB の形で指定してください'

/** 範囲つきの数。はみ出したら 0 件にせず弾く（黙って丸めると、指定した値が効かない）。 */
const bounded = (label: string, min: number, max: number, fallback: number) =>
  z
    .number({ invalid_type_error: `${label}は数で指定してください` })
    .finite()
    .min(min, `${label}は ${String(min)}〜${String(max)} の間で指定してください`)
    .max(max, `${label}は ${String(min)}〜${String(max)} の間で指定してください`)
    .default(fallback)

const color = (fallback: string) => z.string().regex(HEX_COLOR, COLOR_MESSAGE).default(fallback)

/** 強さ（0〜1）。どの型にもある。 */
const intensity = (fallback: number) => bounded('強さ', 0, 1, fallback)

/** 知らない項目は弾く。綴りを間違えた値が黙って既定値になるのを防ぐ。 */
export const FlashParams = z
  .object({
    color: color('#ffffff'),
    intensity: intensity(0.9),
    attackSec: bounded('立ち上がり', 0, 1, 0.03),
    decaySec: bounded('消えるまで', 0.05, 3, 0.35),
  })
  .strict()

export const LightLeakParams = z
  .object({ hue: bounded('色合い', 0, 360, 30), intensity: intensity(0.6) })
  .strict()

export const SpeedLinesParams = z
  .object({
    density: bounded('線の多さ', 0, 1, 0.5),
    intensity: intensity(0.7),
    direction: z.enum(['radial', 'horizontal']).default('radial'),
  })
  .strict()

export const FilmBurnParams = z.object({ intensity: intensity(0.7) }).strict()

export const GlitchParams = z
  .object({ intensity: intensity(0.6), rgbSplit: bounded('色ずれ', 0, 1, 0.5) })
  .strict()

/** タイトルカードの文字数の上限。長いと 1 行に収まらず、勢いが消える。 */
export const MAX_TITLE_CARD_LENGTH = 40
export const MAX_TITLE_CARD_SUBTEXT_LENGTH = 60

export const TitleCardParams = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, 'タイトルの文字を入れてください')
      .max(MAX_TITLE_CARD_LENGTH, `タイトルは ${String(MAX_TITLE_CARD_LENGTH)} 文字までです`)
      .default('タイトル'),
    subtext: z
      .string()
      .trim()
      .max(MAX_TITLE_CARD_SUBTEXT_LENGTH, `添える文字は ${String(MAX_TITLE_CARD_SUBTEXT_LENGTH)} 文字までです`)
      .default(''),
    style: z.enum(['impact', 'elegant']).default('impact'),
    entrance: z.enum(['punch', 'fade']).default('punch'),
    color: color('#ffffff'),
  })
  .strict()

export const ShakeParams = z
  .object({ intensity: intensity(0.5), frequencyHz: bounded('揺れの速さ', 1, 30, 12) })
  .strict()

export const ZoomPunchParams = z
  .object({
    scale: bounded('寄る大きさ', 1.02, 1.4, 1.15),
    /** いちばん寄るのはクリップの頭から何秒か。0 なら頭で寄りきって、そこから戻る。 */
    peakAtSec: bounded('寄りきる時刻', 0, 5, 0),
    decaySec: bounded('戻るまで', 0.05, 3, 0.4),
  })
  .strict()

export type FlashParams = z.infer<typeof FlashParams>
export type LightLeakParams = z.infer<typeof LightLeakParams>
export type SpeedLinesParams = z.infer<typeof SpeedLinesParams>
export type FilmBurnParams = z.infer<typeof FilmBurnParams>
export type GlitchParams = z.infer<typeof GlitchParams>
export type TitleCardParams = z.infer<typeof TitleCardParams>
export type ShakeParams = z.infer<typeof ShakeParams>
export type ZoomPunchParams = z.infer<typeof ZoomPunchParams>

/** 型ごとの値のスキーマ。`satisfies` で鍵の漏れを型で弾く。 */
export const EFFECT_PARAM_SCHEMAS = {
  flash: FlashParams,
  light_leak: LightLeakParams,
  speed_lines: SpeedLinesParams,
  film_burn: FilmBurnParams,
  glitch: GlitchParams,
  title_card: TitleCardParams,
  shake: ShakeParams,
  zoom_punch: ZoomPunchParams,
} as const satisfies Record<EffectTemplateKey, z.ZodTypeAny>

/**
 * 型と値の組。`templateKey` で値の形が決まる。
 * 描く側はこれを受け取るので、型ごとの値を `as` 無しで読める。
 */
export const EffectContent = z.discriminatedUnion('templateKey', [
  z.object({ templateKey: z.literal('flash'), params: FlashParams }),
  z.object({ templateKey: z.literal('light_leak'), params: LightLeakParams }),
  z.object({ templateKey: z.literal('speed_lines'), params: SpeedLinesParams }),
  z.object({ templateKey: z.literal('film_burn'), params: FilmBurnParams }),
  z.object({ templateKey: z.literal('glitch'), params: GlitchParams }),
  z.object({ templateKey: z.literal('title_card'), params: TitleCardParams }),
  z.object({ templateKey: z.literal('shake'), params: ShakeParams }),
  z.object({ templateKey: z.literal('zoom_punch'), params: ZoomPunchParams }),
])
export type EffectContent = z.infer<typeof EffectContent>

export type EffectTemplate = {
  readonly key: EffectTemplateKey
  /** 画面の名前。 */
  readonly label: string
  readonly kind: EffectKind
  /** 置いたときの尺（秒）。 */
  readonly defaultDurationSec: number
  /** いつ使うか。画面の注記とエージェント向けの説明に出す。 */
  readonly hint: string
}

/** 型の一覧（画面に並べる順）。 */
export const EFFECT_TEMPLATES: readonly EffectTemplate[] = Object.freeze([
  { key: 'flash', label: 'フラッシュ', kind: 'overlay', defaultDurationSec: 0.4, hint: 'カットの頭や拍に一瞬だけ光らせる。白で明るく、黒で締める' },
  { key: 'zoom_punch', label: '寄りのパンチ', kind: 'frame', defaultDurationSec: 0.6, hint: '強い拍や曲の盛り上がりで、絵を一瞬ぐっと寄せて戻す' },
  { key: 'shake', label: '揺れ', kind: 'frame', defaultDurationSec: 0.6, hint: '衝突・着地・低音の山で絵を揺らす。短く使う' },
  { key: 'speed_lines', label: 'スピード線', kind: 'overlay', defaultDurationSec: 1, hint: '走り・加速の Shot に重ねて速さを足す。前へ進む絵（車内から・正面）は放射、横から追う絵は横。周りが流れて中央は鮮明のまま' },
  { key: 'glitch', label: 'グリッチ', kind: 'overlay', defaultDurationSec: 0.5, hint: 'カットの境目や曲の切り替わりで、絵を乱して色をずらす' },
  { key: 'light_leak', label: '光漏れ', kind: 'overlay', defaultDurationSec: 1.5, hint: 'ゆるい場面のつなぎや、余韻に暖かい光を流す' },
  { key: 'film_burn', label: 'フィルム焼け', kind: 'overlay', defaultDurationSec: 1.2, hint: '場面の切り替わりや回想の入りを、焼けた光で覆う' },
  { key: 'title_card', label: 'タイトルカード', kind: 'overlay', defaultDurationSec: 2, hint: '頭のタイトル・章の区切り・曲のサビ前に大きな文字を出す' },
])

export const effectTemplateOf = (key: EffectTemplateKey): EffectTemplate => {
  const found = EFFECT_TEMPLATES.find((template) => template.key === key)
  // 一覧と enum は同じ鍵を持つ（テストで検査）。見つからないのは作りの誤り。
  if (found === undefined) throw new Error(`エフェクトの型 ${key} が一覧にありません`)
  return found
}

/** 型の鍵として読めるか。知らない鍵は null（呼び出し側が枠を出す・弾く）。 */
export const effectTemplateKeyOf = (key: string): EffectTemplateKey | null => {
  const parsed = EffectTemplateKey.safeParse(key)
  return parsed.success ? parsed.data : null
}

/**
 * 選ぶ値の画面の言葉。**生の値（radial など）を画面と理由の文に出さない。**
 * 画面の項目（`effect-fields.ts`）と、検証の失敗の文が同じ表を読む。
 */
export const EFFECT_CHOICE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  radial: '中心から',
  horizontal: '横に流れる',
  impact: '太く力強く',
  elegant: '細く上品に',
  punch: '叩きつける',
  fade: 'ふわっと',
})

const choiceLabel = (value: string | number): string => EFFECT_CHOICE_LABELS[String(value)] ?? String(value)

export type EffectParamsResult =
  | { readonly ok: true; readonly value: EffectContent }
  | { readonly ok: false; readonly field: string | null; readonly message: string }

const issueMessage = (template: EffectTemplate, issue: z.ZodIssue): string => {
  // 項目の鍵（attackSec など）は画面に出さない。どの項目かは `field` で返す。
  if (issue.code === 'unrecognized_keys') return `${template.label}に無い項目があります`
  if (issue.code === 'invalid_enum_value') {
    return `${template.label}で選べるのは ${issue.options.map(choiceLabel).join(' / ')} です`
  }
  if (issue.code === 'invalid_type' && issue.expected === 'string') {
    return `${template.label}の文字・色は文字列で指定してください`
  }
  return issue.message
}

/**
 * 型の鍵と値を検証し、既定値を埋めた値を返す。**知らない型・範囲外の値・知らない項目は失敗。**
 * 失敗の文は日本語で、画面とエージェントにそのまま見せられる。
 */
export const parseEffectParams = (templateKey: string, params: unknown): EffectParamsResult => {
  const key = effectTemplateKeyOf(templateKey)
  if (key === null) {
    return {
      ok: false,
      field: 'templateKey',
      message: `知らないエフェクトの型です（選べるのは ${EFFECT_TEMPLATES.map((t) => t.label).join(' / ')}）`,
    }
  }
  const parsed = EffectContent.safeParse({ templateKey: key, params: params ?? {} })
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  const template = effectTemplateOf(key)
  if (issue === undefined) return { ok: false, field: null, message: `${template.label}の値を読めません` }
  const path = issue.path.slice(1)
  const field = issue.code === 'unrecognized_keys' ? (issue.keys[0] ?? null) : path.length > 0 ? path.join('.') : null
  return { ok: false, field, message: issueMessage(template, issue) }
}

/** 型の既定の値（置いた直後の値）。 */
export const defaultEffectParams = (key: EffectTemplateKey): Readonly<Record<string, unknown>> => {
  const parsed = parseEffectParams(key, {})
  // どの型も空の値から既定値で作れる（テストで検査）。作れないのは作りの誤り。
  if (!parsed.ok) throw new Error(`エフェクトの型 ${key} の既定値を作れません: ${parsed.message}`)
  return parsed.value.params
}
