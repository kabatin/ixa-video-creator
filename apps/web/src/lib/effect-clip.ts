import {
  EFFECT_TEMPLATES,
  effectTemplateKeyOf,
  effectTemplateOf,
  parseEffectParams,
  type EffectField,
  type EffectTemplateKey,
  type TimelineClip,
} from '@ixa/domain'
import { formatDuration } from '@/lib/format-time'

/**
 * エフェクト（ADR-0050）の画面の決まりごと。**React を含まない。**
 * 型・範囲・既定値の正は domain（`effect-template.ts`・`effect-fields.ts`）で、ここでは写さない。
 */

/** エフェクトを置くトラック。API もこれ以外を断る。 */
export const EFFECT_TRACK = 'VFX' as const

/** これより短いエフェクトは置かない（タイムラインの終わり際で尺が 0 になるのを防ぐ）。 */
export const MIN_EFFECT_DURATION_SEC = 0.1

export type EffectPickerOption = { readonly key: EffectTemplateKey; readonly label: string; readonly hint: string }

/** 選ぶ欄に並べる型（画面の言葉と使いどころ）。 */
export const EFFECT_PICKER_OPTIONS: readonly EffectPickerOption[] = EFFECT_TEMPLATES.map((t) => ({
  key: t.key,
  label: t.label,
  hint: t.hint,
}))

export type EffectInsertPlan =
  | { readonly ok: true; readonly startSec: number; readonly durationSec: number; readonly layer: number }
  | { readonly ok: false; readonly message: string }

const overlaps = (a: { startSec: number; durationSec: number }, b: { startSec: number; durationSec: number }): boolean =>
  a.startSec < b.startSec + b.durationSec && b.startSec < a.startSec + a.durationSec

/**
 * エフェクトを置く場所。尺は型の既定で、タイムラインの終わりで切る。
 * **重なる相手がいれば上の段へ。** エフェクトは重ねて使う（フラッシュと寄りのパンチを同じ拍に）ので、断らない。
 */
export const planEffectInsert = (input: {
  readonly clips: readonly TimelineClip[]
  readonly templateKey: EffectTemplateKey
  readonly atSec: number
  readonly programEndSec: number
}): EffectInsertPlan => {
  const startSec = Math.max(0, input.atSec)
  const room = input.programEndSec - startSec
  if (room < MIN_EFFECT_DURATION_SEC) {
    return { ok: false, message: 'タイムラインの終わりより後ろには置けません。再生位置を戻してから置いてください' }
  }
  const durationSec = Math.min(effectTemplateOf(input.templateKey).defaultDurationSec, room)
  const span = { startSec, durationSec }
  const taken = new Set(
    input.clips.filter((clip) => clip.track === EFFECT_TRACK && overlaps(clip, span)).map((clip) => clip.layer),
  )
  const layer = Array.from({ length: taken.size + 1 }, (_, i) => i).find((i) => !taken.has(i)) ?? taken.size
  return { ok: true, startSec, durationSec, layer }
}

/** 型の画面の名前。知らない型は鍵のまま（読めない型だと分かるように）。 */
export const effectLabelOf = (templateKey: string): string => {
  const key = effectTemplateKeyOf(templateKey)
  return key === null ? `知らないエフェクト（${templateKey}）` : effectTemplateOf(key).label
}

/** 帯の札。タイトルカードは文字も出す（何が出るか分かるように）。 */
export const effectChipLabel = (content: { readonly templateKey: string; readonly params: unknown }): string => {
  const parsed = parseEffectParams(content.templateKey, content.params)
  if (!parsed.ok) return effectLabelOf(content.templateKey)
  if (parsed.value.templateKey === 'title_card') return `タイトル「${parsed.value.params.text}」`
  return effectTemplateOf(parsed.value.templateKey).label
}

type NumberField = Extract<EffectField, { kind: 'number' }>

/** つまみの刻み。割合・秒・倍率は 0.01、回数・角度は 1。 */
export const effectSliderStep = (field: NumberField): number =>
  field.unit === 'hz' || field.unit === 'deg' ? 1 : 0.01

/** つまみの値の見せ方。**秒は format-time で書く。** px や生の秒は出さない。 */
export const formatEffectValue = (field: NumberField, value: number): string => {
  switch (field.unit) {
    case 'ratio':
      return `${String(Math.round(value * 100))}%`
    case 'sec':
      return formatDuration(value)
    case 'hz':
      return `1 秒に ${String(Math.round(value))} 回`
    case 'deg':
      return `${String(Math.round(value))}°`
    case 'scale':
      return `${value.toFixed(2)} 倍`
  }
}

export type EffectParamsChange =
  | { readonly ok: true; readonly params: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly message: string }

/** 1 項目を変えた値。**domain のスキーマを通す。** 通らなければ保存しない（理由を欄の横に出す）。 */
export const changeEffectParam = (
  content: { readonly templateKey: string; readonly params: unknown },
  key: string,
  value: unknown,
): EffectParamsChange => {
  const current = parseEffectParams(content.templateKey, content.params)
  const base = current.ok ? current.value.params : {}
  const parsed = parseEffectParams(content.templateKey, { ...base, [key]: value })
  return parsed.ok ? { ok: true, params: parsed.value.params } : { ok: false, message: parsed.message }
}
