'use client'

import {
  THUMBNAIL_SUBTITLE_MAX_LENGTH,
  THUMBNAIL_TITLE_MAX_LENGTH,
  THUMBNAIL_ZOOM_MAX,
  THUMBNAIL_ZOOM_MIN,
  type TextFont,
  type ThumbnailLayout,
} from '@ixa/domain'
import type { ReactNode } from 'react'
import { ChoiceCard } from '@/components/ui/choice-card'
import { FONT_LABELS, LAYOUT_LABELS, clampFraction, type ThumbnailForm } from '@/lib/thumbnail-form'

/**
 * サムネイルの見た目の入力（ADR-0051）。寄せ方（拡大・位置）と文字（題名・副題・配置・色・書体）。
 * 値は親が持つ。上限は domain の定数を読む（書き写さない）。
 */

export type FieldsProps = {
  readonly form: ThumbnailForm
  readonly onChange: (patch: Partial<ThumbnailForm>) => void
  readonly disabled?: boolean
}

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  disabled,
}: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly display: string
  readonly onChange: (value: number) => void
  readonly disabled: boolean
}) => (
  <label className="flex flex-col gap-1 text-sm text-text">
    <span className="flex justify-between">
      {label}
      <span className="text-xs text-muted">{display}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
)

const percent = (value: number): string => `${String(Math.round(value * 100))}%`

/** 位置は左（上）の端から右（下）の端まで。真ん中が 50%。 */
export const FramingFields = ({ form, onChange, disabled = false }: FieldsProps) => (
  <fieldset className="flex flex-col gap-2">
    <legend className="mb-1 text-sm font-semibold text-text">寄せ方</legend>
    <Slider
      label="拡大"
      value={form.zoom}
      min={THUMBNAIL_ZOOM_MIN}
      max={THUMBNAIL_ZOOM_MAX}
      step={0.05}
      display={`${form.zoom.toFixed(2)} 倍`}
      onChange={(zoom) => onChange({ zoom })}
      disabled={disabled}
    />
    <Slider
      label="横の位置"
      value={form.focusX}
      min={0}
      max={1}
      step={0.01}
      display={percent(form.focusX)}
      onChange={(value) => onChange({ focusX: clampFraction(value) })}
      disabled={disabled}
    />
    <Slider
      label="縦の位置"
      value={form.focusY}
      min={0}
      max={1}
      step={0.01}
      display={percent(form.focusY)}
      onChange={(value) => onChange({ focusY: clampFraction(value) })}
      disabled={disabled}
    />
  </fieldset>
)

const TextInput = ({
  label,
  value,
  max,
  onChange,
  disabled,
}: {
  readonly label: string
  readonly value: string
  readonly max: number
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}) => (
  <label className="flex flex-col gap-1 text-sm text-text">
    <span className="flex justify-between">
      {label}
      <span className="text-xs text-muted">{`${String([...value.trim()].length)} / ${String(max)} 字`}</span>
    </span>
    <input
      type="text"
      className="rounded border border-line bg-surface px-2 py-1 text-sm"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
)

const Choices = <T extends string>({
  name,
  labels,
  value,
  onChange,
  disabled,
}: {
  readonly name: string
  readonly labels: Readonly<Record<T, string>>
  readonly value: T
  readonly onChange: (value: T) => void
  readonly disabled: boolean
}): ReactNode => (
  <div className="grid grid-cols-3 gap-2">
    {(Object.keys(labels) as T[]).map((key) => (
      <ChoiceCard key={key} name={name} checked={value === key} disabled={disabled} onSelect={() => onChange(key)} stacked>
        <span className="text-sm">{labels[key]}</span>
      </ChoiceCard>
    ))}
  </div>
)

const ColorInput = ({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}) => (
  <label className="flex items-center gap-2 text-sm text-text">
    <input type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    {label}
  </label>
)

export const TextFields = ({ form, onChange, disabled = false }: FieldsProps) => (
  <fieldset className="flex flex-col gap-3">
    <legend className="mb-1 text-sm font-semibold text-text">文字</legend>
    <TextInput label="題名" value={form.title} max={THUMBNAIL_TITLE_MAX_LENGTH} onChange={(title) => onChange({ title })} disabled={disabled} />
    <TextInput
      label="副題（なくてもよい）"
      value={form.subtitle}
      max={THUMBNAIL_SUBTITLE_MAX_LENGTH}
      onChange={(subtitle) => onChange({ subtitle })}
      disabled={disabled}
    />
    <div className="flex flex-col gap-1">
      <span className="text-sm text-text">配置</span>
      <Choices<ThumbnailLayout>
        name="thumbnail-layout"
        labels={LAYOUT_LABELS}
        value={form.layout}
        onChange={(layout) => onChange({ layout })}
        disabled={disabled}
      />
    </div>
    <div className="flex flex-col gap-1">
      <span className="text-sm text-text">書体</span>
      <Choices<TextFont> name="thumbnail-font" labels={FONT_LABELS} value={form.font} onChange={(font) => onChange({ font })} disabled={disabled} />
    </div>
    <div className="flex flex-wrap gap-4">
      <ColorInput label="題名の色" value={form.titleColor} onChange={(titleColor) => onChange({ titleColor })} disabled={disabled} />
      <ColorInput label="差し色" value={form.accentColor} onChange={(accentColor) => onChange({ accentColor })} disabled={disabled} />
    </div>
  </fieldset>
)
