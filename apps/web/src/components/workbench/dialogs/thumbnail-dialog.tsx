'use client'

import { ThumbnailPanel } from '@/components/thumbnail/thumbnail-panel'
import { useLoaded } from '@/components/workbench/use-loaded'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createRequester } from '@/lib/requester'
import { createTimelineApi } from '@/lib/timeline-api'

/**
 * サムネイルを書き出す（ダイアログ。ADR-0051）。
 * プレビューのタイムラインは書き出しの画面と同じ口（`getTimelineDocument`）で読む。読めなくても、
 * 画像の背景（Shot の絵・AI の絵）なら作れるので、画面は開く。
 */
export const ThumbnailDialogBody = () => {
  const workbench = useWorkbench()
  const timeline = useLoaded(
    'タイムライン',
    () => createTimelineApi(createRequester(resolveApiBaseUrl())).getTimelineDocument(workbench.projectId),
    `${workbench.projectId}:${String(workbench.serverEpoch)}`,
  )

  return (
    <ThumbnailPanel
      projectId={workbench.projectId}
      defaultTitle={workbench.project.name}
      shots={workbench.shots ?? []}
      posters={workbench.posters}
      timeline={timeline.state === 'ready' ? timeline.value : null}
      timelineError={timeline.state === 'error' ? timeline.message : null}
    />
  )
}
