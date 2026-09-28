'use client'

import { resolveTextStyle, type TextStyle, type TextTemplateKey } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveCheckbox, AutoSaveColor, AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { Section } from '@/components/workbench/ui/section'
import {
  ALIGN_OPTIONS,
  ANCHOR_GRID,
  BACKGROUND_OPACITY_OPTIONS,
  FADE_OPTIONS,
  FONT_OPTIONS,
  SHADOW_OPTIONS,
  STROKE_WIDTH_OPTIONS,
  WEIGHT_OPTIONS,
  offsetPercentLabel,
  parseOffsetPercent,
  parseSizePercent,
  sizePercentLabel,
} from '@/lib/text-style-form'

/** 1 項目ぶんの上書き。`undefined` は「型の既定値に戻す」。 */
export type TextStylePatch = Partial<Record<keyof TextStyle, unknown>>

/**
 * テロップの見た目・位置・フェード（ADR-0028）。**変えた項目だけを親へ渡す。**
 * 表示は型の既定値に上書きを重ねた最終の値（何も指定していない項目も、いまの見た目が分かる）。
 */
export const TextStyleFields = ({
  template,
  style,
  disabled = false,
  onChange,
  onReset,
}: {
  readonly template: TextTemplateKey
  readonly style: TextStyle
  readonly disabled?: boolean
  readonly onChange: (patch: TextStylePatch) => Promise<void>
  readonly onReset: () => Promise<void>
}) => {
  const resolved = resolveTextStyle(template, style)
  const set = (patch: TextStylePatch) => onChange(patch)
  const stroke = resolved.stroke
  const background = resolved.background

  return (
    <>
      <Section
        title="見た目"
        action={
          <Button size="sm" disabled={disabled} onClick={() => void onReset()}>
            型の既定に戻す
          </Button>
        }
      >
        <AutoSaveSelect label="書体" value={resolved.font} options={FONT_OPTIONS} disabled={disabled} onSave={(next) => set({ font: next })} />
        <AutoSaveField
          label="大きさ（%）"
          value={sizePercentLabel(resolved.size)}
          placeholder="自動"
          disabled={disabled}
          validate={(next) => {
            const parsed = parseSizePercent(next)
            return parsed.ok ? null : parsed.reason
          }}
          onSave={(next) => {
            const parsed = parseSizePercent(next)
            return set({ size: parsed.ok ? parsed.value : undefined })
          }}
        />
        <p className="text-xs text-muted">大きさは画面の高さに対する %。空欄は文字数から自動で決めます。</p>
        <AutoSaveSelect label="太さ" value={resolved.weight} options={WEIGHT_OPTIONS} disabled={disabled} onSave={(next) => set({ weight: next })} />
        <AutoSaveColor label="色" value={resolved.color} disabled={disabled} onSave={(next) => set({ color: next })} />
        <AutoSaveSelect label="影" value={resolved.shadow} options={SHADOW_OPTIONS} disabled={disabled} onSave={(next) => set({ shadow: next })} />
        <AutoSaveCheckbox
          label="縁取り"
          checked={stroke !== null}
          disabled={disabled}
          onSave={(next) => set({ stroke: next ? { color: '#000000', width: 0.12 } : null })}
        />
        {stroke !== null && (
          <>
            <AutoSaveColor label="縁の色" value={stroke.color} disabled={disabled} onSave={(next) => set({ stroke: { ...stroke, color: next } })} />
            <AutoSaveSelect
              label="縁の太さ"
              value={String(stroke.width)}
              options={withCurrent(STROKE_WIDTH_OPTIONS, String(stroke.width))}
              disabled={disabled}
              onSave={(next) => set({ stroke: { ...stroke, width: Number(next) } })}
            />
          </>
        )}
        <AutoSaveCheckbox
          label="背景の帯"
          checked={background !== null}
          disabled={disabled}
          onSave={(next) => set({ background: next ? { color: '#000000', opacity: 0.55 } : null })}
        />
        {background !== null && (
          <>
            <AutoSaveColor label="帯の色" value={background.color} disabled={disabled} onSave={(next) => set({ background: { ...background, color: next } })} />
            <AutoSaveSelect
              label="帯の濃さ"
              value={String(background.opacity)}
              options={withCurrent(BACKGROUND_OPACITY_OPTIONS, String(background.opacity))}
              disabled={disabled}
              onSave={(next) => set({ background: { ...background, opacity: Number(next) } })}
            />
          </>
        )}
        <AutoSaveSelect label="揃え" value={resolved.align} options={ALIGN_OPTIONS} disabled={disabled} onSave={(next) => set({ align: next })} />
      </Section>

      <Section title="位置">
        <div role="group" aria-label="画面のどこに置くか" className="grid w-32 grid-cols-3 gap-1">
          {ANCHOR_GRID.flat().map((cell) => (
            <button
              key={cell.anchor}
              type="button"
              aria-label={`${cell.label}に置く`}
              aria-pressed={resolved.anchor === cell.anchor}
              disabled={disabled}
              onClick={() => void set({ anchor: cell.anchor })}
              className={`h-7 rounded border text-xs ${
                resolved.anchor === cell.anchor
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-line-strong bg-bg text-muted hover:bg-surface'
              }`}
            >
              {cell.label}
            </button>
          ))}
        </div>
        <AutoSaveField
          label="横ずらし（%）"
          value={offsetPercentLabel(resolved.offset.x)}
          disabled={disabled}
          validate={(next) => {
            const parsed = parseOffsetPercent(next)
            return parsed.ok ? null : parsed.reason
          }}
          onSave={(next) => {
            const parsed = parseOffsetPercent(next)
            return set({ offset: { ...resolved.offset, x: parsed.ok ? (parsed.value ?? 0) : 0 } })
          }}
        />
        <AutoSaveField
          label="縦ずらし（%）"
          value={offsetPercentLabel(resolved.offset.y)}
          disabled={disabled}
          validate={(next) => {
            const parsed = parseOffsetPercent(next)
            return parsed.ok ? null : parsed.reason
          }}
          onSave={(next) => {
            const parsed = parseOffsetPercent(next)
            return set({ offset: { ...resolved.offset, y: parsed.ok ? (parsed.value ?? 0) : 0 } })
          }}
        />
        <p className="text-xs text-muted">ずらしは画面の幅・高さに対する %（右・下が +）。</p>
      </Section>

      <Section title="出入り">
        <AutoSaveSelect
          label="フェードイン"
          value={String(resolved.fadeInSec)}
          options={withCurrent(FADE_OPTIONS, String(resolved.fadeInSec))}
          disabled={disabled}
          onSave={(next) => set({ fadeInSec: Number(next) })}
        />
        <AutoSaveSelect
          label="フェードアウト"
          value={String(resolved.fadeOutSec)}
          options={withCurrent(FADE_OPTIONS, String(resolved.fadeOutSec))}
          disabled={disabled}
          onSave={(next) => set({ fadeOutSec: Number(next) })}
        />
      </Section>
    </>
  )
}

/**
 * 選択肢に無い値（API から直接入れたなど）でも、**今の値を黙って別の値に見せない。**
 * 無ければ今の値を選択肢の先頭に足す。
 */
const withCurrent = (
  options: readonly { readonly value: string; readonly label: string }[],
  current: string,
): readonly { readonly value: string; readonly label: string }[] =>
  options.some((option) => option.value === current) ? options : [{ value: current, label: current }, ...options]
