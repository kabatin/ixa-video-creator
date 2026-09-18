'use client'

import type { LocationId, Shot } from '@ixa/domain'
import { useState } from 'react'
import { GeneratePanel } from '@/components/generate-panel'
import { ReviewPanel } from '@/components/review-panel'
import { ShotCastEditor } from '@/components/shot-cast-editor'
import { ShotEditor } from '@/components/shot-editor'
import { ShotLocationEditor, type LocationSaveFeedback } from '@/components/shot-location-editor'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { useShotTakes } from '@/components/workbench/use-shot-takes'
import {
  INSPECTOR_TABS,
  useWorkbench,
  type InspectorTab,
} from '@/components/workbench/workbench-context'
import { PanelNotice } from '@/components/workbench/panels/panel-frame'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { GenerateTakesBody, type WireGenerateResult } from '@/lib/api-schemas'
import { formatSpan } from '@/lib/format-time'
import { isGeneratingStatus } from '@/lib/shot-display'

const TAB_LABELS: Readonly<Record<InspectorTab, string>> = {
  settings: '設定',
  generate: '生成',
  review: 'レビュー',
}

export type ShotInspectorProps = {
  readonly shot: Shot
  /** 先頭の Shot は前のカットと繋げない。 */
  readonly isFirst: boolean
}

/**
 * インスペクター（右）。選択中の Shot をタブで見る: 設定 / 生成 / レビュー（UI-WORKBENCH §3.1）。
 * 旧 Shot 詳細の右の欄と、ストーリーボードの「Shot 設定」をここに吸収した（§3.2）。
 *
 * Shot の保存は Provider の `saveShot` 経由。一覧・ストーリーボードが同じ値を見る。
 */
export const ShotInspector = ({ shot, isFirst }: ShotInspectorProps) => {
  const workbench = useWorkbench()
  const tab = workbench.inspectorTab
  const tabId = (value: InspectorTab): string => `inspector-tab-${value}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 py-1">
        <strong className="text-sm text-text">{shot.code}</strong>
        <span className="truncate text-xs tabular-nums text-muted">
          {formatSpan(shot.startSec, shot.durationSec)}
        </span>
        <span className="ml-auto">
          <ShotStatusBadge status={shot.status} />
        </span>
      </div>
      <div role="tablist" aria-label="インスペクター" className="flex shrink-0 border-b border-line">
        {INSPECTOR_TABS.map((value) => (
          <button
            key={value}
            id={tabId(value)}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${tabId(value)}-panel`}
            onClick={() => {
              workbench.openInspector(value)
            }}
            className={`h-7 flex-1 text-sm ${
              tab === value
                ? 'border-b-2 border-accent font-semibold text-text'
                : 'text-muted hover:text-text'
            }`}
          >
            {TAB_LABELS[value]}
          </button>
        ))}
      </div>
      <div
        id={`${tabId(tab)}-panel`}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        className="workbench-panel-body min-h-0 flex-1 space-y-3 overflow-auto"
      >
        {/* Shot を替えたら入力途中の値を持ち越さない。 */}
        {tab === 'settings' && <SettingsTab key={shot.id} shot={shot} isFirst={isFirst} />}
        {tab === 'generate' && <GenerateTab key={shot.id} shot={shot} />}
        {tab === 'review' && <ReviewTab key={shot.id} shot={shot} />}
      </div>
    </div>
  )
}

/** 設定: 接続・ロケーション・登場人物・コード / 時間 / 説明 / mood / カメラ。 */
const SettingsTab = ({ shot, isFirst }: ShotInspectorProps) => {
  const workbench = useWorkbench()
  const generating = isGeneratingStatus(shot.status)
  const [locationSaving, setLocationSaving] = useState(false)
  const [locationFeedback, setLocationFeedback] = useState<LocationSaveFeedback | null>(null)

  const saveLocation = async (next: LocationId | null): Promise<void> => {
    setLocationSaving(true)
    setLocationFeedback(null)
    try {
      await workbench.saveShot(shot.id, { locationId: next })
      setLocationFeedback({ tone: 'success', message: 'ロケーションを保存しました。' })
    } catch (cause) {
      setLocationFeedback({
        tone: 'error',
        message: `ロケーションを保存できませんでした: ${describeError(cause)}`,
      })
    } finally {
      setLocationSaving(false)
    }
  }

  return (
    <>
      <ContinuityField shot={shot} isFirst={isFirst} disabled={generating} />
      <ShotLocationEditor
        locations={workbench.locations ?? []}
        loadError={workbench.locations === null ? 'ロケーションを読み込めませんでした。' : undefined}
        locationId={shot.locationId}
        saving={locationSaving}
        disabled={generating}
        feedback={locationFeedback}
        onSave={(next) => {
          void saveLocation(next)
        }}
      />
      <ShotCastEditor
        shotId={shot.id}
        workspaceId={workbench.project.workspaceId}
        disabled={generating}
      />
      {/* 生成中は Take が増える途中なので、尺や開始秒を動かさせない。 */}
      <ShotEditor shot={shot} disabled={generating} deleteAfter="refresh" />
    </>
  )
}

/**
 * 前の Shot との接続（ADR-0019 / 0020）。旧ストーリーボードの「Shot 設定」から移した。
 * 選んだ時点で保存する（保存ボタンを探させない）。
 */
const ContinuityField = ({
  shot,
  isFirst,
  disabled,
}: ShotInspectorProps & { readonly disabled: boolean }) => {
  const workbench = useWorkbench()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = `continuity-${shot.id}`

  const save = async (next: Shot['continuityMode']): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await workbench.saveShot(shot.id, { continuityMode: next })
    } catch (cause) {
      setError(`接続を保存できませんでした: ${describeError(cause)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-md border border-line bg-surface p-2">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        前の Shot との接続
      </label>
      <select
        id={id}
        value={isFirst ? 'independent' : shot.continuityMode}
        disabled={disabled || saving || isFirst}
        onChange={(event) => {
          void save(event.target.value === 'previous_shot' ? 'previous_shot' : 'independent')
        }}
        className="mt-1 h-7 w-full rounded border border-line-strong bg-bg px-2 text-sm text-text"
      >
        <option value="independent">独立したカット</option>
        {!isFirst && <option value="previous_shot">前の Shot から画を繋ぐ</option>}
      </select>
      <p className="mt-1 text-xs text-muted">
        {isFirst
          ? '先頭の Shot には前のカットがないため接続できません。'
          : shot.continuityMode === 'previous_shot'
            ? '前の採用 Take の最終フレームを開始画像にします。境界で約1フレーム止まって見える場合があります。'
            : '前のカットの絵を生成入力に使いません。'}
      </p>
      {error !== null && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

/** 生成: モデルと本数を決めて投げる。完了は SSE で Shot の状態に届く。 */
const GenerateTab = ({ shot }: { readonly shot: Shot }) => {
  const workbench = useWorkbench()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<WireGenerateResult | null>(null)
  const generating = isGeneratingStatus(shot.status)

  const generate = async (model: string, count: number): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await createApiClient().generateTakes(
        shot.id,
        GenerateTakesBody.parse({ model, count }),
      )
      setLastResult(result)
      // サーバと同じ遷移を先回りして映す。完了は SSE が届ける。
      workbench.replaceShots([{ ...shot, status: 'generating' }])
    } catch (cause) {
      setError(`生成を開始できませんでした: ${describeError(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error !== null && <PanelNotice tone="danger">{error}</PanelNotice>}
      <GeneratePanel
        busy={busy || generating}
        generating={generating}
        lastResult={lastResult}
        onGenerate={(model, count) => {
          void generate(model, count)
        }}
      />
    </>
  )
}

/** レビュー: 採用中の Take に対して行う。未採用なら理由を出す。 */
const ReviewTab = ({ shot }: { readonly shot: Shot }) => {
  const workbench = useWorkbench()
  const { takes, error, replaceTake } = useShotTakes(shot, workbench.posterEpoch)
  const selected = takes?.find((take) => take.id === shot.selectedTakeId) ?? null

  if (error !== null) return <PanelNotice tone="danger">{error}</PanelNotice>
  if (takes === null) return <p className="text-sm text-muted">Take を読み込んでいます…</p>
  if (selected === null) {
    return (
      <p className="text-sm text-muted">
        採用中の Take がありません。Take 比較で採用するとレビューできます。
      </p>
    )
  }
  return (
    <ReviewPanel
      shotId={shot.id}
      takeId={selected.id}
      humanVerdict={selected.humanVerdict}
      onVerdictSaved={replaceTake}
    />
  )
}
