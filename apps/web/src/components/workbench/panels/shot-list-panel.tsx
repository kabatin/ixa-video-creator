'use client'

import type { ShotStatus } from '@ixa/domain'
import { useMemo, useState } from 'react'
import {
  BulkActionBar,
  type BulkModelOption,
  type BulkSelectOption,
} from '@/components/bulk-action-bar'
import { ShotListCompact } from '@/components/workbench/shot-list-compact'
import { useBulkActions } from '@/components/workbench/use-bulk-actions'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { SHOT_SIZE_OPTIONS } from '@/lib/camera-options'
import { MODEL_OPTIONS } from '@/lib/generation-options'
import { toLocationOptions } from '@/lib/location-options'
import {
  clearSelection,
  headerCheckboxState,
  selectAllVisible,
  toggleShot,
} from '@/lib/shot-bulk'
import { shotStatusLabel } from '@/lib/shot-display'

/** 選べるモデル。いまは AUTO だけだが、選択肢の正は `generation-options` に置いたまま。 */
const MODEL_CHOICES: readonly BulkModelOption[] = MODEL_OPTIONS.flatMap((option) =>
  option.value === 'AUTO' ? [{ value: 'AUTO' as const, label: option.label }] : [],
)

const STATUSES: readonly ShotStatus[] = ['draft', 'ready', 'generating', 'review', 'approved', 'blocked']
const ALL = 'all'

/**
 * Shot 一覧（右）。探して選ぶ場所。チェックした Shot はまとめて動かせる（P58）。
 * 絞り込みは表示だけ。**チェックは絞り込みで隠れても外さない**（隠れた行を黙って対象から外さない）。
 */
export const ShotListPanel = () => {
  const workbench = useWorkbench()
  const bulk = useBulkActions()
  const [filter, setFilter] = useState<ShotStatus | typeof ALL>(ALL)
  const shots = workbench.shots

  const visible = useMemo(
    () => (shots ?? []).filter((shot) => filter === ALL || shot.status === filter),
    [shots, filter],
  )
  const visibleIds = visible.map((shot) => shot.id)
  const chosen = (shots ?? []).filter((shot) => workbench.checked.has(shot.id))

  /** ロケーションが読めなかったことを選択肢の側で出し、空と混ぜない（L-015）。 */
  const locationOptions: readonly BulkSelectOption[] =
    workbench.locations === null
      ? [{ value: '__unavailable__', label: 'ロケーションを取れませんでした' }]
      : toLocationOptions(workbench.locations)

  const toolbar = (
    <>
      <span className="text-muted">
        {shots === null ? '—' : `${String(visible.length)} / ${String(shots.length)} 件`}
      </span>
      <label className="ml-auto flex items-center gap-1 text-xs text-muted">
        <span className="sr-only">状態で絞り込む</span>
        <select
          value={filter}
          onChange={(event) => {
            const next = event.target.value
            setFilter(STATUSES.find((status) => status === next) ?? ALL)
          }}
          className="h-6 rounded border border-line-strong bg-surface px-1 text-xs text-text"
        >
          <option value={ALL}>すべて</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {shotStatusLabel(status)}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        onClick={() => {
          workbench.openDialog('new-shot')
        }}
      >
        新規
      </Button>
    </>
  )

  if (shots === null) {
    return (
      <PanelFrame toolbar={toolbar}>
        <PanelEmpty title="Shot を読み込めていません" />
      </PanelFrame>
    )
  }

  return (
    <PanelFrame toolbar={toolbar} flush>
      <div className="flex min-h-full flex-col">
        {workbench.live.newTakeCount > 0 && (
          <p role="status" className="border-b border-line px-2 py-1 text-xs text-text">
            {`開いてから ${String(workbench.live.newTakeCount)} 本の Take ができました。`}
          </p>
        )}
        {workbench.posterError !== null && (
          <div className="px-2 pt-2">
            <PanelNotice tone="warn">{workbench.posterError}</PanelNotice>
          </div>
        )}
        <div className="flex-1">
          <ShotListCompact
            shots={visible}
            posters={workbench.posters}
            selectedShotId={workbench.selectedShotId}
            checked={workbench.checked}
            headerState={headerCheckboxState(workbench.checked, visibleIds)}
            busy={bulk.busy}
            onSelect={workbench.selectShot}
            onToggle={(shotId) => {
              workbench.setChecked(toggleShot(workbench.checked, shotId))
            }}
            onToggleAll={() => {
              workbench.setChecked(
                headerCheckboxState(workbench.checked, visibleIds) === 'all'
                  ? clearSelection()
                  : selectAllVisible(visibleIds),
              )
            }}
          />
        </div>
        <BulkActionBar
          selectedCount={chosen.length}
          alreadySelectedCount={chosen.filter((shot) => shot.selectedTakeId !== null).length}
          lockedCount={chosen.filter((shot) => shot.lockedAt !== null).length}
          modelOptions={MODEL_CHOICES}
          cameraSizeOptions={SHOT_SIZE_OPTIONS}
          locationOptions={locationOptions}
          busy={bulk.busy}
          outcome={bulk.outcome}
          onGenerate={bulk.generate}
          onSelectTakes={bulk.selectTakes}
          onUpdate={bulk.update}
          onClearSelection={() => {
            workbench.setChecked(clearSelection())
            bulk.clearOutcome()
          }}
        />
      </div>
    </PanelFrame>
  )
}
