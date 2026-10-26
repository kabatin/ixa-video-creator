'use client'

import { TEXT_STYLE_KEY_LABELS, type ResolvedTextStyle } from '@ixa/domain'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { Section } from '@/components/workbench/ui/section'
import { marginPercentLabel, parseMarginPercent, parsePaddingPercent } from '@/lib/text-style-form'
import type { TextStylePatch } from '@/components/workbench/inspector/text-style-fields'

/**
 * テロップの箱の余白。外側（画面の端から）は画面の幅・高さの %、帯の内側は文字の大きさの %。
 * 空欄にすると項目を外し、型の既定に戻す。左右の余白の空欄は「型の流し込み幅のまま」。
 */

type BoxKey = 'marginX' | 'marginY' | 'paddingX' | 'paddingY'

const FIELDS: readonly { readonly key: BoxKey; readonly parse: typeof parseMarginPercent }[] = [
  { key: 'marginX', parse: parseMarginPercent },
  { key: 'marginY', parse: parseMarginPercent },
  { key: 'paddingX', parse: parsePaddingPercent },
  { key: 'paddingY', parse: parsePaddingPercent },
]

export const TextBoxFields = ({
  resolved,
  disabled,
  onChange,
}: {
  readonly resolved: ResolvedTextStyle
  readonly disabled: boolean
  readonly onChange: (patch: TextStylePatch) => Promise<void>
}) => (
  <Section title="余白">
    {FIELDS.map(({ key, parse }) => (
      <AutoSaveField
        key={key}
        label={TEXT_STYLE_KEY_LABELS[key]}
        value={marginPercentLabel(resolved[key])}
        placeholder="型の既定"
        disabled={disabled}
        validate={(next) => {
          const parsed = parse(next)
          return parsed.ok ? null : parsed.reason
        }}
        onSave={(next) => {
          const parsed = parse(next)
          return onChange({ [key]: parsed.ok && parsed.value !== null ? parsed.value : undefined })
        }}
      />
    ))}
    <p className="text-xs text-muted">
      余白は画面の端からの %（左右は画面の幅、上下は画面の高さ）。内側の余白は帯の中の余白で、文字の大きさに対する %（帯があるときだけ効く）。空欄は型の既定です。
    </p>
  </Section>
)
