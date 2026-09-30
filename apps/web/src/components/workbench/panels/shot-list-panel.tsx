'use client'

import type { ShotId, ShotStatus } from '@ixa/domain'
import { useMemo, useState } from 'react'
import {
  BulkActionBar,
  type BulkModelOption,
  type BulkSelectOption,
} from '@/components/bulk-action-bar'
import { useAssets } from '@/components/workbench/asset-store'
import { ShotListCompact } from '@/components/workbench/shot-list-compact'
import { useAssetDrop } from '@/components/workbench/use-asset-drop'
import { useBulkActions } from '@/components/workbench/use-bulk-actions'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { SHOT_SIZE_OPTIONS } from '@/lib/camera-options'
import { MODEL_OPTIONS } from '@/lib/generation-options'
import {
  alignmentByShotId,
  buildShotAlignments,
  isDrifting,
} from '@/lib/beat-alignment-view'
import { toLocationOptions } from '@/lib/location-options'
import { clearSelection, headerCheckboxState, selectAllVisible, toggleShot } from '@/lib/shot-bulk'
import { shotStatusLabel } from '@/lib/shot-display'
import {
  rangeBetween,
  sortShots,
  statusCounts,
  type ShotSortKey,
  type SortDirection,
} from '@/lib/shot-list-view'
import { useNow } from '@/components/workbench/use-active-generations'
import { describeActiveGeneration } from '@/lib/generation-progress'

/** 選べるモデル。いまは AUTO だけだが、選択肢の正は `generation-options` に置いたまま。 */
const MODEL_CHOICES: readonly BulkModelOption[] = MODEL_OPTIONS.flatMap((option) =>
  option.value === 'AUTO' ? [{ value: 'AUTO' as const, label: option.label }] : [],
)

/**
 * Shot 一覧（右。UI-WORKBENCH-2 §7）。探して選ぶ場所。チェックした Shot はまとめて動かせる（P58）。
 * 絞り込みは状態のチップ。**チェックは絞り込みで隠れても外さない**（隠れた行を黙って対象から外さない）。
 * 一括操作はチェックがあるときだけ、一覧の**上**に出す（下に積むと 27 行の下に沈む）。
 */
/** 絞り込みの値。状態そのものと、状態ではない「拍ズレ」を 1 つの型で持つ。 */
const DRIFT_FILTER = 'drift' as const
type ShotFilter = ShotStatus | typeof DRIFT_FILTER | null

export const ShotListPanel = () => {
  const workbench = useWorkbench()
  // 生成中の様子（どのモデルで・経過・目安）。動いている生成があるあいだだけ毎秒刻む。
  const now = useNow(workbench.activeGenerations.size > 0)
  const activityOf = (shotId: ShotId): string | null => {
    const generation = workbench.activeGenerations.get(shotId)?.[0]
    return generation === undefined ? null : describeActiveGeneration(generation, now).short
  }
  const bulk = useBulkActions()
  const drop = useAssetDrop(workbench.notify)
  /** 状態のほかに「拍以外に合わせているもの」でも絞れる。集計の 1 行から中身へ行けるように。 */
  const [filter, setFilter] = useState<ShotFilter>(null)
  const [sort, setSort] = useState<{ key: ShotSortKey; direction: SortDirection }>({
    key: 'order',
    direction: 'asc',
  })
  const [anchor, setAnchor] = useState<ShotId | null>(null)
  const shots = workbench.shots

  const numbers = useMemo(
    () =>
      new Map(
        sortShots(shots ?? [], 'order', 'asc').map((shot, index) => [shot.id, index + 1] as const),
      ),
    [shots],
  )
  /**
   * 拍とのズレ。判定は `@ixa/domain` の 1 箇所なので、ストーリーボードやタイムラインと必ず一致する。
   * 楽曲や解析が無いときは null にして列ごと出さない（「—」を並べても読み手に情報が無い）。
   */
  const alignments = useMemo(() => {
    const { analysis, track } = workbench
    if (shots === null || analysis === null || track === null || analysis.beats.length === 0) {
      return null
    }
    return alignmentByShotId(buildShotAlignments(shots, analysis.beats, analysis.downbeats))
  }, [shots, workbench.analysis, workbench.track])

  const driftingCount = useMemo(
    () => (shots ?? []).filter((shot) => isDrifting(alignments?.get(shot.id))).length,
    [shots, alignments],
  )

  const visible = useMemo(
    () =>
      sortShots(
        (shots ?? []).filter((shot) =>
          filter === null
            ? true
            : filter === DRIFT_FILTER
              ? isDrifting(alignments?.get(shot.id))
              : shot.status === filter,
        ),
        sort.key,
        sort.direction,
      ),
    [shots, filter, sort, alignments],
  )
  const visibleIds = visible.map((shot) => shot.id)
  const chosen = (shots ?? []).filter((shot) => workbench.checked.has(shot.id))

  /** ロケーションは素材の共有状態から。読めなかったことは選択肢の側で出し、空と混ぜない（L-015）。 */
  const { locations } = useAssets()
  const locationOptions: readonly BulkSelectOption[] =
    locations.state === 'ready'
      ? toLocationOptions(locations.value)
      : [
          {
            value: '__unavailable__',
            label: locations.state === 'loading' ? '読み込み中…' : 'ロケーションを取れませんでした',
          },
        ]

  const chip = (value: ShotFilter, label: string, count: number) => (
    <button
      key={value ?? 'all'}
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`h-6 shrink-0 rounded-full px-2 text-xs ring-1 ${
        filter === value
          ? 'bg-accent text-accent-fg ring-accent'
          : 'text-muted ring-line-strong hover:text-text'
      }`}
    >
      {`${label} ${String(count)}`}
    </button>
  )

  const toolbar = (
    <>
      {chip(null, 'すべて', shots?.length ?? 0)}
      {statusCounts(shots ?? []).map(([status, count]) =>
        chip(status, shotStatusLabel(status), count),
      )}
      {/* 集計を読むだけで終わらせない。押すとその Shot だけになる。 */}
      {alignments !== null && driftingCount > 0 && chip(DRIFT_FILTER, '拍以外', driftingCount)}
      <span className="ml-auto" />
      <Button size="sm" onClick={() => workbench.openDialog('new-shot')}>
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
        <BulkActionBar
          selectedCount={chosen.length}
          alreadySelectedCount={chosen.filter((shot) => shot.selectedTakeId !== null).length}
          lockedCount={chosen.filter((shot) => shot.lockedAt !== null).length}
          modelOptions={MODEL_CHOICES}
          cameraSizeOptions={SHOT_SIZE_OPTIONS}
          locationOptions={locationOptions}
          /*
            **押す前の金額は API から取れない。** `POST .../shots/bulk/generate` が
            `estimatedTotalUsd` を返すのは 202（投入したあと）か 422（予算超過で 1 件も
            投入しなかったとき）だけで、投入せずに見積だけ取る口は無い
            （`apps/api/src/routes/shots-bulk.ts`）。だから `null` を渡し、
            確認の文面で「事前には出せない」と断る。**黙って空欄にしない。**
          */
          estimatedTotalUsd={null}
          busy={bulk.busy}
          progress={bulk.progress}
          outcome={bulk.outcome}
          onGenerate={bulk.generate}
          onSelectTakes={bulk.selectTakes}
          onUpdate={bulk.update}
          onDrawStartFrames={bulk.drawStartFrames}
          onMerge={() => {
            workbench.openDialog('merge-shots')
          }}
          onDelete={() => {
            workbench.openDialog('delete-shots')
          }}
          onClearSelection={() => {
            workbench.setChecked(clearSelection())
            bulk.clearOutcome()
          }}
        />
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
        <ShotListCompact
          shots={visible}
          posters={workbench.posters}
          selectedShotId={workbench.selectedShotId}
          checked={workbench.checked}
          headerState={headerCheckboxState(workbench.checked, visibleIds)}
          busy={bulk.busy}
          sort={sort}
          numberOf={(id) => numbers.get(id) ?? 0}
          alignmentOf={(id) => alignments?.get(id)}
          showBeat={alignments !== null}
          onSort={(key) => {
            setSort((current) =>
              current.key === key
                ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                : { key, direction: 'asc' },
            )
          }}
          onSelect={workbench.selectShot}
          onToggle={(shotId, range) => {
            if (range && anchor !== null) {
              const ids = rangeBetween(visibleIds, anchor, shotId)
              workbench.setChecked(
                ids.reduce(
                  (selection, id) => (selection.has(id) ? selection : toggleShot(selection, id)),
                  workbench.checked,
                ),
              )
            } else {
              workbench.setChecked(toggleShot(workbench.checked, shotId))
            }
            setAnchor(shotId)
          }}
          onToggleAll={() => {
            workbench.setChecked(
              headerCheckboxState(workbench.checked, visibleIds) === 'all'
                ? clearSelection()
                : selectAllVisible(visibleIds),
            )
          }}
          dropHandlers={drop.handlers}
          dropState={drop.stateOf}
          activityOf={activityOf}
        />
      </div>
    </PanelFrame>
  )
}
