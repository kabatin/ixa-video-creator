'use client'

import type { ProjectId } from '@ixa/domain'
import { RenderPanel } from '@/components/render-panel'
import { useLoaded } from '@/components/workbench/use-loaded'
import type { RenderWatch } from '@/components/workbench/use-render-watch'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRenderApi, type WireRenderJob } from '@/lib/render-api'
import { renderRangeChoice } from '@/lib/render-range'
import { createRequester } from '@/lib/requester'
import { createTimelineApi } from '@/lib/timeline-api'
import type { TimelineIssueView } from '@/lib/timeline-issues'

type Part<T> = { readonly value: T | null; readonly error: string | null }

type RenderMaterials = {
  readonly jobs: Part<readonly WireRenderJob[]>
  readonly issues: Part<readonly TimelineIssueView[]>
  readonly durationSec: number | null
}

const attempt = async <T,>(label: string, run: () => Promise<T>): Promise<Part<T>> => {
  try {
    return { value: await run(), error: null }
  } catch (error) {
    return { value: null, error: `${label}を読み込めませんでした: ${describeError(error)}` }
  }
}

/**
 * 部分ごとに成否を持つ。「0 件」と「読めていない」を混ぜない（L-015）。
 * 未検査が「指摘なし」に化けると、止まるはずの書き出しが通って見える。
 */
const loadRenderMaterials = async (projectId: ProjectId): Promise<RenderMaterials> => {
  const requester = createRequester(resolveApiBaseUrl())
  const renderApi = createRenderApi(requester)
  const timelineApi = createTimelineApi(requester)
  const [jobs, issues, document] = await Promise.all([
    attempt('書き出しの履歴', () => renderApi.listRenderJobs(projectId)),
    // 検証はサーバの validateTimeline が唯一の正（L-016）。
    attempt('投入前の検査結果', () => timelineApi.getTimelineIssues(projectId)),
    attempt('TimelineDocument', () => timelineApi.getTimelineDocument(projectId)),
  ])
  return { jobs, issues, durationSec: document.value?.durationSec ?? null }
}

/**
 * 書き出し（ダイアログ。UI-WORKBENCH §3.3）。左で設定・書き出す前の確認・実行、右で履歴とフォルダ（ADR-0036）。
 * 開いたまま書き出しが終わっても、閉じればワークベンチの選択はそのまま残る。
 */
export const RenderDialogBody = ({ watch }: { readonly watch: RenderWatch }) => {
  const workbench = useWorkbench()
  const loaded = useLoaded(
    '書き出しの材料',
    () => loadRenderMaterials(workbench.projectId),
    workbench.projectId,
  )

  if (loaded.state === 'loading') return <p className="text-sm text-muted">読み込んでいます…</p>
  if (loaded.state === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        {loaded.message}
      </p>
    )
  }
  const { jobs, issues, durationSec } = loaded.value

  return (
    <RenderPanel
      projectId={workbench.projectId}
      initialJobs={jobs.value}
      jobsError={jobs.error}
      watch={watch}
      issues={issues.value}
      issuesError={issues.error}
      timelineDurationSec={durationSec}
      // 選んだ Shot だけを書き出す範囲（チェックがあればチェックした Shot、無ければ選んでいる 1 件）。
      range={renderRangeChoice({
        shots: workbench.shots ?? [],
        checked: workbench.checked,
        selectedShotId: workbench.selectedShotId,
        issues: issues.value,
      })}
      onFixTimeline={() => {
        workbench.closeDialog()
        workbench.focusPanel('timeline')
      }}
    />
  )
}
