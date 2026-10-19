'use client'

import { useEffect, useMemo } from 'react'
import { RoughCutPanel } from '@/components/rough-cut-panel'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { SnapSourceSummary } from '@/components/timeline-snap-panel'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import { useTimelineMaterials } from '@/components/workbench/use-timeline-materials'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { programEndSec } from '@/lib/timeline-display'
import { timelineLoadErrors } from '@/lib/timeline-loader'
import { buildSnapCandidates } from '@/lib/timeline-snap'

export type ChecksPanelProps = {
  /** 指摘の件数が分かるたびに呼ぶ。タブの題に件数を出すため。null は「検査できていない」。 */
  readonly onIssueCount?: (count: number | null) => void
}

/**
 * 検査（下の区画）。タイムラインの帯の上に積んでいた道具をここへ移した（制作者 2026-10-19）。
 *
 * - 検証の指摘。種類ごとの束は開いておく
 * - 粗編集の提案。**指摘の真下に置く**（「重なり 72 件」を見た人が次に取る行動がこれ）
 * - ビート吸着の候補。入り切りはタイムラインのツールバーの「拍に吸着」
 *
 * 材料はタイムラインのタブとは別に自分で取る（§7.3）。
 */
export const ChecksPanel = ({ onIssueCount }: ChecksPanelProps) => {
  const workbench = useWorkbench()
  const materials = useTimelineMaterials()
  const shots = workbench.shots
  const shotCodes = useMemo(() => new Map((shots ?? []).map((shot) => [shot.id, shot.code])), [shots])

  const issues = materials?.issues.value ?? null
  const issueCount = materials === null ? null : (issues?.length ?? null)
  useEffect(() => {
    onIssueCount?.(issueCount)
  }, [onIssueCount, issueCount])

  const candidates = useMemo(
    () =>
      materials === null
        ? []
        : buildSnapCandidates(
            {
              shots: shots ?? [],
              clips: materials.clips.value ?? [],
              beatSource: materials.beatSource,
              timelineEndSec: materials.document.value?.durationSec ?? programEndSec(shots ?? []),
              lyricCues: workbench.project.lyricCues,
            },
            { clipId: null },
          ),
    [materials, shots, workbench.project.lyricCues],
  )

  if (materials === null) {
    return (
      <PanelFrame>
        <p className="text-sm text-muted">検査の結果を読み込んでいます…</p>
      </PanelFrame>
    )
  }

  const loadErrors = timelineLoadErrors(materials)
  return (
    <PanelFrame>
      <div className="space-y-3">
        {loadErrors.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-lg border border-danger/40 bg-danger/10 p-3">
            {loadErrors.map((message) => (
              <li key={message} className="text-sm text-danger">
                {message}
              </li>
            ))}
          </ul>
        )}
        <TimelineIssuePanel
          issues={issues}
          projectId={workbench.projectId}
          onTimelineChanged={workbench.refresh}
          expandGroups
        />
        <RoughCutPanel projectId={workbench.projectId} shotCodes={shotCodes} onApplied={workbench.refresh} />
        <SnapSourceSummary beatSource={materials.beatSource} candidates={candidates} />
      </div>
    </PanelFrame>
  )
}
