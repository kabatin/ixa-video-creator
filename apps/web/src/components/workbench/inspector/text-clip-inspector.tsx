'use client'

import { TextTemplateKey, type TimelineClipId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { TextStyleFields, type TextStylePatch } from '@/components/workbench/inspector/text-style-fields'
import { TextStylePresets } from '@/components/workbench/inspector/text-style-presets'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { MoreMenu } from '@/components/workbench/ui/more-menu'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatClock, formatDuration, formatSpan } from '@/lib/format-time'
import { textClipSpanIssue } from '@/lib/text-clip-span'
import { TEXT_TEMPLATE_LABELS, readTextClipParams, withStyle } from '@/lib/text-style-form'
import type { TimelineApi, WireTimelineClip } from '@/lib/timeline-api'
import { programEndSec } from '@/lib/timeline-display'
import { parseClockInput, parseDurationInput } from '@/lib/time-input'

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly clips: readonly WireTimelineClip[] }
  | { readonly kind: 'error'; readonly message: string }

const TEMPLATE_OPTIONS = TextTemplateKey.options.map((key) => ({ value: key, label: TEXT_TEMPLATE_LABELS[key] }))

/**
 * テロップのインスペクター（ADR-0028）。文字・型・開始・尺・見た目・位置・フェードと、スタイルの保存・一括適用。
 * 欄は確定ごとに自動保存し、プレビューとタイムラインは読み直しで追いつく（`workbench.refresh`）。
 *
 * **帯のテロップを押すとここで開く。** 以前は帯の上の小窓で直していたが、パネルの端で見切れて
 * 編集しづらかった（2026-09-28、制作者の指摘）。小窓が受け持っていた開始・尺・削除もここに置く。
 */
export const TextClipInspector = ({ id, api }: { readonly id: TimelineClipId; readonly api?: TimelineApi }) => {
  const workbench = useWorkbench()
  const client = useMemo<TimelineApi>(() => api ?? createApiClient(), [api])
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    client
      .listClips(workbench.projectId)
      .then((clips) => {
        if (alive) setLoaded({ kind: 'ready', clips })
      })
      .catch((cause: unknown) => {
        if (alive) setLoaded({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [client, workbench.projectId, workbench.serverEpoch])

  if (loaded.kind === 'loading') return <PanelEmpty title="テロップを読み込んでいます…" />
  if (loaded.kind === 'error') return <PanelEmpty title="テロップを読めませんでした" hint={loaded.message} />

  const clip = loaded.clips.find((candidate) => candidate.id === id)
  if (clip === undefined || clip.content.type !== 'text') {
    return <PanelEmpty title="このテロップは見つかりません" hint="消されたか、まだ読み込めていません。" />
  }
  const content = clip.content
  const template = TextTemplateKey.safeParse(content.templateKey)
  const params = readTextClipParams(content.params)

  const replace = (updated: readonly WireTimelineClip[]): void => {
    const byId = new Map(updated.map((candidate) => [candidate.id, candidate]))
    setLoaded({ kind: 'ready', clips: loaded.clips.map((candidate) => byId.get(candidate.id) ?? candidate) })
    workbench.refresh()
  }
  const save = async (next: Partial<typeof content>): Promise<void> => {
    replace([await client.updateClip(clip.id, { content: { ...content, ...next } })])
  }
  const saveStyle = (patch: TextStylePatch) => save({ params: withStyle(content.params, patch) })
  const saveSpan = async (span: { readonly startSec?: number; readonly durationSec?: number }): Promise<void> => {
    replace([await client.updateClip(clip.id, span)])
  }
  /** 帯の小窓と同じ規則（重なり・短すぎる尺）で見る。形が読めなければ書式を案内する。 */
  const spanIssue = (startSec: number | null, durationSec: number | null, format: string): string | null =>
    startSec === null || durationSec === null
      ? format
      : textClipSpanIssue({
          clips: loaded.clips,
          clip,
          programEndSec: programEndSec(workbench.shots ?? []),
          startSec,
          durationSec,
        })

  const textClips = loaded.clips
    .filter((candidate) => candidate.content.type === 'text')
    .map((candidate) => ({
      id: candidate.id,
      styleId: readTextClipParams(candidate.content.type === 'text' ? candidate.content.params : null)?.styleId ?? null,
    }))

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader
        kind="テロップ"
        title={params?.text ?? '（文字が読めません）'}
        meta={formatSpan(clip.startSec, clip.durationSec)}
        menu={
          <MoreMenu
            label={`テロップ「${params?.text ?? ''}」のその他の操作`}
            items={[
              {
                label: 'テロップを削除',
                confirm: `テロップ「${params?.text ?? ''}」${formatSpan(clip.startSec, clip.durationSec)} を削除します。`,
                run: async () => {
                  await client.deleteClip(clip.id)
                  workbench.inspect(null)
                  workbench.refresh()
                },
              },
            ]}
          />
        }
      />
      <div className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        <Section title="文字">
          <AutoSaveField
            label="文字"
            value={params?.text ?? ''}
            validate={(next) => (next.trim() === '' ? '文字を入れてください' : null)}
            onSave={(next) => save({ params: { ...content.params, text: next.trim() } })}
          />
          {template.success ? (
            <AutoSaveSelect
              label="型"
              value={template.data}
              options={TEMPLATE_OPTIONS}
              onSave={(next) => save({ templateKey: next })}
            />
          ) : (
            <p role="alert" className="text-xs text-danger">
              {`知らない型「${content.templateKey}」です。型を選び直すと見た目を直せます。`}
            </p>
          )}
        </Section>
        <Section title="時間">
          <AutoSaveField
            label="開始"
            value={formatClock(clip.startSec)}
            validate={(next) =>
              spanIssue(parseClockInput(next), clip.durationSec, '0:12.34 か 12.34 の形で入れてください')
            }
            onSave={(next) => saveSpan({ startSec: parseClockInput(next) ?? clip.startSec })}
          />
          <AutoSaveField
            label="尺"
            value={formatDuration(clip.durationSec)}
            validate={(next) =>
              spanIssue(clip.startSec, parseDurationInput(next), '1.50s のように 0 より大きい秒で入れてください')
            }
            onSave={(next) => saveSpan({ durationSec: parseDurationInput(next) ?? clip.durationSec })}
          />
        </Section>
        {template.success && params !== null && (
          <>
            <TextStyleFields
              template={template.data}
              style={params.style}
              onChange={saveStyle}
              onReset={() => save({ params: { ...content.params, style: {} } })}
            />
            <TextStylePresets
              projectId={workbench.projectId}
              clipId={clip.id}
              style={params.style}
              styleId={params.styleId}
              textClips={textClips}
              onApplied={replace}
            />
          </>
        )}
      </div>
    </div>
  )
}
