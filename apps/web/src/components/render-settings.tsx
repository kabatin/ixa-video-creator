import type { RenderPreset } from '@ixa/domain'
import type { ReactNode } from 'react'
import { formatLongDuration } from '@/lib/format-time'
import { RENDER_PRESET_OPTIONS } from '@/lib/render-display'
import type { RenderRangeChoice } from '@/lib/render-range'
import { ChoiceCard } from '@/components/ui/choice-card'

/**
 * 書き出しの設定（範囲と画質）。どちらも**カードの形の選択**にする（制作者 2026-10-03「UI/UX が雑な印象」）。
 * 中身は本物のラジオボタンなので、キーボードと読み上げはそのまま使える。
 */

/** カードの形の選択（`ui/choice-card.tsx`。新規作成・設定と共有）。 */
const Choice = ChoiceCard

const Heading = ({ children }: { readonly children: ReactNode }) => (
  <legend className="mb-2 text-xs font-semibold text-muted">{children}</legend>
)

export const RenderRangeField = ({
  range,
  onlyRange,
  onChange,
  timelineDurationSec,
  disabled,
}: {
  readonly range: RenderRangeChoice | null
  readonly onlyRange: boolean
  readonly onChange: (onlyRange: boolean) => void
  /** 書き出される長さ。読めなければ null。 */
  readonly timelineDurationSec: number | null
  readonly disabled: boolean
}) => (
  <fieldset disabled={disabled}>
    <Heading>範囲</Heading>
    <div className="flex flex-col gap-2">
      <Choice name="render-range" checked={!onlyRange} disabled={disabled} onSelect={() => onChange(false)}>
        <span className="text-sm font-medium text-text">全体</span>
        <span className="text-xs tabular-nums text-muted">
          {timelineDurationSec === null ? '長さを読み込めませんでした' : formatLongDuration(timelineDurationSec)}
        </span>
      </Choice>
      {range !== null && (
        <Choice name="render-range" checked={onlyRange} disabled={disabled} onSelect={() => onChange(true)}>
          <span className="text-sm font-medium text-text">{`選んだ Shot だけ ${range.label}`}</span>
          <span className="text-xs tabular-nums text-muted">{range.span}</span>
          {range.extraNote !== null && <span className="text-xs text-muted">{range.extraNote}</span>}
        </Choice>
      )}
    </div>
    {range === null && (
      <p className="mt-2 text-xs text-muted">Shot を選んでから開くと、その Shot だけを書き出せます。</p>
    )}
  </fieldset>
)

export const RenderPresetField = ({
  preset,
  onChange,
  disabled,
}: {
  readonly preset: RenderPreset
  readonly onChange: (preset: RenderPreset) => void
  readonly disabled: boolean
}) => (
  <fieldset disabled={disabled}>
    <Heading>画質</Heading>
    <div className="grid grid-cols-2 gap-2">
      {RENDER_PRESET_OPTIONS.map((option) => (
        <Choice
          key={option.value}
          name="render-preset"
          checked={preset === option.value}
          disabled={disabled}
          onSelect={() => onChange(option.value)}
        >
          <span className="text-sm font-medium text-text">{option.label}</span>
          <span className="text-xs text-muted">{option.hint}</span>
        </Choice>
      ))}
    </div>
  </fieldset>
)
