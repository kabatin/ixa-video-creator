import { z } from 'zod'
import { EFFECT_PARAM_SCHEMAS, type EffectTemplateKey } from './effect-template.js'

/**
 * エフェクトの値を画面で直すための項目の並び（ADR-0050）。
 *
 * **範囲・既定値・選べる値はスキーマ（`effect-template.ts`）から読む。ここに数を書き写さない。**
 * 書き写すと、スキーマの範囲を変えたときに画面のつまみだけが古い範囲のまま残る。
 * ここが持つのは、画面の言葉（項目名・選択肢の名前）と、値の見せ方（割合・秒・角度など）だけ。
 */

/** 値の見せ方。`ratio` は 0〜1 を割合で、`sec` は秒（画面は format-time で書く）。 */
export type EffectNumberUnit = 'ratio' | 'sec' | 'hz' | 'deg' | 'scale'

export type EffectField =
  | {
      readonly kind: 'number'
      readonly key: string
      readonly label: string
      readonly unit: EffectNumberUnit
      readonly min: number
      readonly max: number
      readonly defaultValue: number
    }
  | { readonly kind: 'color'; readonly key: string; readonly label: string; readonly defaultValue: string }
  | {
      readonly kind: 'text'
      readonly key: string
      readonly label: string
      readonly maxLength: number
      readonly defaultValue: string
    }
  | {
      readonly kind: 'choice'
      readonly key: string
      readonly label: string
      readonly options: readonly { readonly value: string; readonly label: string }[]
      readonly defaultValue: string
    }

type FieldSpec =
  | { readonly label: string; readonly unit: EffectNumberUnit }
  | { readonly label: string; readonly control: 'color' | 'text' }
  | { readonly label: string; readonly choices: Readonly<Record<string, string>> }

type ParamKeys<K extends EffectTemplateKey> = keyof z.infer<(typeof EFFECT_PARAM_SCHEMAS)[K]>

/** 型ごと・項目ごとの画面の言葉。鍵は型で縛ってあるので、項目を足して書き忘れると型検査で落ちる。 */
const FIELD_SPECS: { readonly [K in EffectTemplateKey]: Readonly<Record<ParamKeys<K>, FieldSpec>> } = {
  flash: {
    color: { label: '色', control: 'color' },
    intensity: { label: '強さ', unit: 'ratio' },
    attackSec: { label: '立ち上がり', unit: 'sec' },
    decaySec: { label: '消えるまで', unit: 'sec' },
  },
  light_leak: { hue: { label: '色合い', unit: 'deg' }, intensity: { label: '強さ', unit: 'ratio' } },
  speed_lines: {
    density: { label: '線の多さ', unit: 'ratio' },
    intensity: { label: '強さ', unit: 'ratio' },
    direction: { label: '向き', choices: { radial: '中心から', horizontal: '横に流れる' } },
  },
  film_burn: { intensity: { label: '強さ', unit: 'ratio' } },
  glitch: { intensity: { label: '強さ', unit: 'ratio' }, rgbSplit: { label: '色ずれ', unit: 'ratio' } },
  title_card: {
    text: { label: 'タイトル', control: 'text' },
    subtext: { label: '添える文字', control: 'text' },
    style: { label: '書体', choices: { impact: '太く力強く', elegant: '細く上品に' } },
    entrance: { label: '出方', choices: { punch: '叩きつける', fade: 'ふわっと' } },
    color: { label: '色', control: 'color' },
  },
  shake: { intensity: { label: '強さ', unit: 'ratio' }, frequencyHz: { label: '揺れの速さ', unit: 'hz' } },
  zoom_punch: {
    scale: { label: '寄る大きさ', unit: 'scale' },
    peakAtSec: { label: '寄りきる時刻', unit: 'sec' },
    decaySec: { label: '戻るまで', unit: 'sec' },
  },
}

/** `.default()` を剥がして、中の型と既定値を取り出す。 */
const unwrapDefault = (schema: z.ZodTypeAny): { readonly inner: z.ZodTypeAny; readonly fallback: unknown } =>
  schema instanceof z.ZodDefault
    ? { inner: schema.removeDefault() as z.ZodTypeAny, fallback: schema._def.defaultValue() }
    : { inner: schema, fallback: undefined }

const toField = (key: string, spec: FieldSpec, schema: z.ZodTypeAny): EffectField => {
  const { inner, fallback } = unwrapDefault(schema)
  if ('unit' in spec && inner instanceof z.ZodNumber) {
    return {
      kind: 'number', key, label: spec.label, unit: spec.unit,
      min: inner.minValue ?? 0, max: inner.maxValue ?? 1, defaultValue: typeof fallback === 'number' ? fallback : 0,
    }
  }
  if ('choices' in spec && inner instanceof z.ZodEnum) {
    // ZodEnum の instanceof は中身の型を失うので、文字列だけを拾い直す。
    const raw: unknown = inner.options
    const values = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
    return {
      kind: 'choice', key, label: spec.label,
      options: values.map((value) => ({ value, label: spec.choices[value] ?? value })),
      defaultValue: typeof fallback === 'string' ? fallback : (values[0] ?? ''),
    }
  }
  if ('control' in spec && inner instanceof z.ZodString) {
    const defaultValue = typeof fallback === 'string' ? fallback : ''
    return spec.control === 'color'
      ? { kind: 'color', key, label: spec.label, defaultValue }
      : { kind: 'text', key, label: spec.label, maxLength: inner.maxLength ?? 0, defaultValue }
  }
  throw new Error(`エフェクトの項目 ${key} の見せ方とスキーマの型が合いません`)
}

/** 型の項目の並び（スキーマの順）。 */
export const effectFieldsOf = (templateKey: EffectTemplateKey): readonly EffectField[] => {
  const schema: z.ZodObject<z.ZodRawShape> = EFFECT_PARAM_SCHEMAS[templateKey]
  const shape: z.ZodRawShape = schema.shape
  const specs: Readonly<Record<string, FieldSpec>> = FIELD_SPECS[templateKey]
  return Object.entries(shape).map(([key, schema]) => {
    const spec = specs[key]
    if (spec === undefined) throw new Error(`エフェクトの項目 ${key} に画面の言葉がありません`)
    return toField(key, spec, schema)
  })
}
