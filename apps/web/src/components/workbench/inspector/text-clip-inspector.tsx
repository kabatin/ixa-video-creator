'use client'

import { TextTemplateKey, narrationLineOf, textStyleChangeSummary, type TextStyle, type TextStyleKey, type TimelineClipId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { TextStyleFields, type TextStylePatch } from '@/components/workbench/inspector/text-style-fields'
import { TextStylePresets } from '@/components/workbench/inspector/text-style-presets'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { MenuButton } from '@/components/workbench/ui/more-menu'
import { useTextClipMenu } from '@/components/workbench/use-text-clip-menu'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatClock, formatDuration, formatSpan } from '@/lib/format-time'
import { textClipSpanIssue } from '@/lib/text-clip-span'
import { TEXT_TEMPLATE_LABELS, readTextClipParams, withStyle } from '@/lib/text-style-form'
import type { TimelineApi, WireTimelineClip } from '@/lib/timeline-api'
import type { TextStyleApi } from '@/lib/text-style-api'
import {
  RESET_ALL_STYLE,
  resolveTextClipScope,
  textClipScopes,
  toStyleChange,
  type TextClipScope,
  type TextClipScopeId,
} from '@/lib/text-clip-scope'
import { DEFAULT_PX_PER_SEC, programEndSec } from '@/lib/timeline-display'
import {
  beatSourceOf,
  buildSnapCandidates,
  snapEnd,
  snapNoticeClassName,
  snapPoint,
  snapToleranceSec,
  type SnapNotice,
} from '@/lib/timeline-snap'
import { usePreferences } from '@/components/preferences-root'
import { parseClockInput, parseDurationInput } from '@/lib/time-input'

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly clips: readonly WireTimelineClip[] }
  | { readonly kind: 'error'; readonly message: string }

const TEMPLATE_OPTIONS = TextTemplateKey.options.map((key) => ({ value: key, label: TEXT_TEMPLATE_LABELS[key] }))

/**
 * 変える範囲（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * 「このテロップだけ」以外のときは目立たせる（うっかり全部を変えないように）。
 */
const ScopePicker = ({
  scopes,
  current,
  onChange,
}: {
  readonly scopes: readonly TextClipScope[]
  readonly current: TextClipScope
  readonly onChange: (id: TextClipScopeId) => void
}) => (
  <div
    role="radiogroup"
    aria-label="変える範囲"
    className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-1.5 text-xs ${
      current.id === 'this' ? 'text-muted' : 'bg-warn/15 text-text ring-1 ring-warn'
    }`}
  >
    <span className="font-semibold">変える範囲</span>
    {scopes.map((scope) => (
      <label key={scope.id} className="flex items-center gap-1">
        <input
          type="radio"
          name="text-clip-scope"
          checked={scope.id === current.id}
          onChange={() => {
            onChange(scope.id)
          }}
          className="h-3.5 w-3.5"
        />
        {scope.label}
      </label>
    ))}
  </div>
)

/**
 * テロップのインスペクター（ADR-0028）。文字・型・開始・尺・見た目・位置・フェードと、スタイルの保存・一括適用。
 * 欄は確定ごとに自動保存し、プレビューとタイムラインは読み直しで追いつく（`workbench.refresh`）。
 *
 * **帯のテロップを押すとここで開く。** 以前は帯の上の小窓で直していたが、パネルの端で見切れて
 * 編集しづらかった（2026-09-28、制作者の指摘）。小窓が受け持っていた開始・尺・削除もここに置く。
 */
/** 「変える範囲」の選択を外で持つ口。インスペクターはテロップごとに作り直すので、続けて直すには外で持つ。 */
export type TextClipScopeChoice = {
  readonly value: TextClipScopeId
  readonly onChange: (id: TextClipScopeId) => void
}

export const TextClipInspector = ({
  id,
  api,
  scopeChoice,
}: {
  readonly id: TimelineClipId
  readonly api?: TimelineApi
  /** 渡さなければ、このインスペクターの中だけで持つ（「このテロップだけ」から）。 */
  readonly scopeChoice?: TextClipScopeChoice
}) => {
  const workbench = useWorkbench()
  const textClipMenu = useTextClipMenu()
  const client = useMemo<TimelineApi>(() => api ?? createApiClient(), [api])
  const styleClient = useMemo<Pick<TextStyleApi, 'applyTextStyle'>>(() => createApiClient(), [])
  const [ownScope, setOwnScope] = useState<TextClipScopeId>('this')
  const wantedScope = scopeChoice?.value ?? ownScope
  const chooseScope = scopeChoice?.onChange ?? setOwnScope
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const { preferences } = usePreferences()
  /** 開始・尺を拍へ寄せた結果。どのテロップのものかを持つ（別のテロップを開いたら出さない）。 */
  const [snapped, setSnapped] = useState<{ readonly clipId: TimelineClipId; readonly notice: SnapNotice } | null>(
    null,
  )

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
  const scopes = textClipScopes(loaded.clips, clip.id)
  const scope = resolveTextClipScope(scopes, wantedScope, clip.id)
  /** 範囲の全部に、変えた項目だけを当てる。変更の履歴に残るので、件数と「戻せます」を知らせる。 */
  const applyToScope = async (change: {
    readonly set: TextStyle
    readonly unset: readonly TextStyleKey[]
  }): Promise<void> => {
    const updated = await styleClient.applyTextStyle(workbench.projectId, {
      clipIds: [...scope.clipIds],
      set: change.set,
      unset: [...change.unset],
    })
    replace(updated)
    const keys = { set: Object.keys(change.set) as TextStyleKey[], unset: change.unset }
    workbench.notify(`${textStyleChangeSummary(scope.clipIds.length, keys)}（変更の履歴から戻せます）`)
  }
  const saveStyle = (patch: TextStylePatch) =>
    scope.id === 'this' ? save({ params: withStyle(content.params, patch) }) : applyToScope(toStyleChange(patch))
  const resetStyle = () =>
    scope.id === 'this' ? save({ params: { ...content.params, style: {} } }) : applyToScope(RESET_ALL_STYLE)
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

  /**
   * 開始・尺の拍への吸着（制作者 2026-10-01「テロップ吸着繋ぎ」）。**規則は引きずり・数値の一覧と同じ**
   * （`timeline-snap` → `@ixa/timeline`）。入切は環境設定、許容距離はタイムラインの既定の拡大率のもの。
   * 自分の端は候補から外す（外さないと自分へ寄って動かせない）。
   */
  const shots = workbench.shots ?? []
  const snapCandidates = buildSnapCandidates(
    {
      shots,
      clips: loaded.clips,
      beatSource: beatSourceOf(workbench.track, workbench.analysis),
      timelineEndSec: programEndSec(shots),
    },
    { clipId: clip.id },
  )
  const snapTolerance = snapToleranceSec(DEFAULT_PX_PER_SEC)
  const snapEnabled = preferences.playback.snapToBeat
  const saveStart = (requestedSec: number): Promise<void> => {
    const point = snapPoint('開始', requestedSec, snapCandidates, snapTolerance, snapEnabled)
    setSnapped({ clipId: clip.id, notice: point.notice })
    return saveSpan({ startSec: point.atSec })
  }
  const saveDuration = (requestedSec: number): Promise<void> => {
    const end = snapEnd(
      { startSec: clip.startSec, durationSec: requestedSec },
      snapCandidates,
      snapTolerance,
      snapEnabled,
    )
    setSnapped({ clipId: clip.id, notice: end.notice })
    return saveSpan({ durationSec: end.durationSec })
  }
  // 寄せた・見送ったときだけ言う（寄らなかった・切ってあるは、入れた値のままなので黙る）。
  const snapNotice =
    snapped !== null &&
    snapped.clipId === clip.id &&
    (snapped.notice.state === 'snapped' || snapped.notice.state === 'rejected')
      ? snapped.notice
      : null

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
          // 帯の右クリックと同じ中身（2026-09-30）。インスペクターでは削除だけ。
          <MenuButton
            label={`テロップ「${params?.text ?? ''}」のその他の操作`}
            items={textClipMenu.itemsFor(clip, 'inspector')}
          />
        }
      />
      <div className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        <Section title="文字">
          {narrationLineOf(content.params) !== null && (
            // ナレーションのテロップは行から導かれる（ADR-0038）。ここで直しても、行を直すと作り直される。
            <p role="note" className="text-xs text-warn">
              ナレーションの行から作ったテロップです。字と時刻は、ナレーションの行の「表示」と位置で直してください
              （ここで直しても、行を直したときに作り直されます。見た目は残ります）。
            </p>
          )}
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
            onSave={(next) => saveStart(parseClockInput(next) ?? clip.startSec)}
          />
          <AutoSaveField
            label="尺"
            value={formatDuration(clip.durationSec)}
            validate={(next) =>
              spanIssue(clip.startSec, parseDurationInput(next), '1.50s のように 0 より大きい秒で入れてください')
            }
            onSave={(next) => saveDuration(parseDurationInput(next) ?? clip.durationSec)}
          />
          {snapNotice !== null && (
            <p role="status" className={`text-xs ${snapNoticeClassName(snapNotice.state)}`}>
              {`${snapNotice.label}: ${snapNotice.message}`}
            </p>
          )}
        </Section>
        {template.success && params !== null && (
          <>
            <ScopePicker
              scopes={scopes}
              current={scope}
              onChange={chooseScope}
            />
            <TextStyleFields
              template={template.data}
              style={params.style}
              onChange={saveStyle}
              onReset={resetStyle}
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
