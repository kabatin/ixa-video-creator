'use client'

import {
  defaultEffectParams,
  effectFieldsOf,
  effectTemplateKeyOf,
  effectTemplateOf,
  parseEffectParams,
  type EffectField,
  type EffectTemplateKey,
  type TimelineClipId,
} from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveColor, AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { AutoSaveSlider } from '@/components/workbench/ui/auto-save-slider'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import {
  EFFECT_PICKER_OPTIONS,
  EFFECT_TRACK,
  changeEffectParam,
  effectLabelOf,
  effectSliderStep,
  formatEffectValue,
} from '@/lib/effect-clip'
import { formatClock, formatDuration } from '@/lib/format-time'
import type { WireTimelineClip } from '@/lib/timeline-api'
import { parseClockInput, parseDurationInput } from '@/lib/time-input'

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly clip: WireTimelineClip | null }
  | { readonly kind: 'error'; readonly message: string }

type Save = (patch: Parameters<ReturnType<typeof createApiClient>['updateClip']>[1]) => Promise<void>

const TEMPLATE_OPTIONS = EFFECT_PICKER_OPTIONS.map((option) => ({ value: option.key, label: option.label }))

/** 1 項目の欄。範囲・既定値・選べる値は domain のスキーマから（`effectFieldsOf`）。 */
const EffectParamField = ({
  field,
  params,
  onChange,
}: {
  readonly field: EffectField
  readonly params: Readonly<Record<string, unknown>>
  readonly onChange: (key: string, value: unknown) => Promise<void>
}) => {
  const current = params[field.key]
  switch (field.kind) {
    case 'number':
      return (
        <AutoSaveSlider
          label={field.label}
          value={typeof current === 'number' ? current : field.defaultValue}
          min={field.min}
          max={field.max}
          step={effectSliderStep(field)}
          format={(value) => formatEffectValue(field, value)}
          onSave={(next) => onChange(field.key, next)}
        />
      )
    case 'color':
      return (
        <AutoSaveColor
          label={field.label}
          value={typeof current === 'string' ? current : field.defaultValue}
          onSave={(next) => onChange(field.key, next)}
        />
      )
    case 'choice':
      return (
        <AutoSaveSelect
          label={field.label}
          value={typeof current === 'string' ? current : field.defaultValue}
          options={field.options}
          onSave={(next) => onChange(field.key, next)}
        />
      )
    case 'text':
      return (
        <AutoSaveField
          label={field.label}
          value={typeof current === 'string' ? current : field.defaultValue}
          {...(field.key === 'subtext' ? { placeholder: '無くてもかまいません' } : {})}
          onSave={(next) => onChange(field.key, next)}
        />
      )
  }
}

/** 中身。型と値が読めたときだけ出す。 */
const EffectBody = ({ clip, templateKey, save }: { readonly clip: WireTimelineClip; readonly templateKey: EffectTemplateKey; readonly save: Save }) => {
  if (clip.content.type !== 'motion_graphics') return null
  const content = clip.content
  const parsed = parseEffectParams(content.templateKey, content.params)
  const params = parsed.ok ? parsed.value.params : defaultEffectParams(templateKey)
  const changeParam = async (key: string, value: unknown): Promise<void> => {
    const changed = changeEffectParam(content, key, value)
    if (!changed.ok) throw new Error(changed.message)
    await save({ content: { type: 'motion_graphics', templateKey, params: { ...changed.params } } })
  }
  return (
    <Section title="見え方">
      {!parsed.ok && (
        <p role="alert" className="text-xs text-danger">
          {`値を読めないので既定の値を出しています（${parsed.message}）`}
        </p>
      )}
      {effectFieldsOf(templateKey).map((field) => (
        <EffectParamField key={field.key} field={field} params={params} onChange={changeParam} />
      ))}
      <p className="text-xs text-muted">{effectTemplateOf(templateKey).hint}</p>
    </Section>
  )
}

/**
 * エフェクトのクリップ（ADR-0050）。型・強さ・位置・長さを直し、消す。
 * 値の形と範囲は domain のスキーマだけが持ち、ここは並べるだけ。直したらサーバの材料を読み直す（プレビューが追いつく）。
 */
export const EffectInspector = ({ id }: { readonly id: TimelineClipId }) => {
  const workbench = useWorkbench()
  const api = useMemo(() => createApiClient(), [])
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listClips(workbench.projectId, EFFECT_TRACK)
      .then((clips) => {
        if (alive) setLoaded({ kind: 'ready', clip: clips.find((candidate) => candidate.id === id) ?? null })
      })
      .catch((cause: unknown) => {
        if (alive) setLoaded({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [api, id, workbench.projectId, workbench.serverEpoch])

  if (loaded.kind === 'loading') return <PanelEmpty title="エフェクトを読み込んでいます…" />
  if (loaded.kind === 'error') return <PanelEmpty title="エフェクトを読めませんでした" hint={loaded.message} />
  const clip = loaded.clip
  if (clip === null || clip.content.type !== 'motion_graphics') {
    return <PanelEmpty title="このエフェクトは見つかりません" hint="消されたか、まだ読み込めていません。" />
  }
  const templateKey = effectTemplateKeyOf(clip.content.templateKey)

  const save: Save = async (patch) => {
    const updated = await api.updateClip(id, patch)
    setLoaded({ kind: 'ready', clip: updated })
    workbench.refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader kind="エフェクト" title={effectLabelOf(clip.content.templateKey)} meta={`${formatClock(clip.startSec)}・${formatDuration(clip.durationSec)}`} />
      <div className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        <Section title="エフェクト">
          <AutoSaveSelect
            label="種類"
            value={templateKey ?? ''}
            options={templateKey === null ? [{ value: '', label: '選んでください' }, ...TEMPLATE_OPTIONS] : TEMPLATE_OPTIONS}
            // 種類を変えたら値は新しい種類の既定に戻す（前の種類の値は持ち越せない）。
            onSave={async (next) => {
              const key = effectTemplateKeyOf(next)
              if (key === null) return
              await save({ content: { type: 'motion_graphics', templateKey: key, params: { ...defaultEffectParams(key) } } })
            }}
          />
          <AutoSaveField
            label="位置"
            value={formatClock(clip.startSec)}
            validate={(next) => (parseClockInput(next) === null ? '0:03.75 のように入れてください' : null)}
            onSave={(next) => save({ startSec: parseClockInput(next) ?? clip.startSec })}
          />
          <AutoSaveField
            label="長さ"
            value={formatDuration(clip.durationSec)}
            validate={(next) => (parseDurationInput(next) === null ? '0.40s のように入れてください' : null)}
            onSave={(next) => save({ durationSec: parseDurationInput(next) ?? clip.durationSec })}
          />
        </Section>
        {templateKey === null ? (
          <p role="alert" className="px-1 text-xs text-danger">
            知らない種類のエフェクトです。種類を選び直すか、消してください。
          </p>
        ) : (
          <EffectBody key={templateKey} clip={clip} templateKey={templateKey} save={save} />
        )}
        <Section title="消す">
          <p className="text-xs text-muted">帯の上でつかんで動かし、端を引いて長さを変えることもできます。</p>
          <Button
            size="sm"
            onClick={() => {
              setError(null)
              api
                .deleteClip(id)
                .then(() => {
                  workbench.inspect(null)
                  workbench.refresh()
                })
                .catch((cause: unknown) => {
                  setError(`消せませんでした: ${describeForPerson(cause)}`)
                })
            }}
          >
            このエフェクトを消す
          </Button>
          {error !== null && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </Section>
      </div>
    </div>
  )
}
