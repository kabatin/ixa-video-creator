'use client'

import { useEffect, useState } from 'react'
import { TimelineEditor } from '@/components/timeline-editor'
import { usePreferences } from '@/components/preferences-root'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import {
  loadTimelineMaterials,
  renderedShotIdsOf,
  timelineLoadErrors,
  type TimelineMaterials,
} from '@/lib/timeline-loader'

/**
 * タイムライン（中央下）。中身は既存の `timeline-editor`。
 *
 * **モニターは持たない。** 再生位置はワークベンチの 1 箇所を見て、絵はプレビューのパネルに出す
 * （UI-WORKBENCH §3.1）。材料はこのパネルが自分で取る（§7.3）。
 */
export const TimelinePanel = () => {
  const workbench = useWorkbench()
  const { preferences } = usePreferences()
  const { transport, transportControls } = workbench
  const [materials, setMaterials] = useState<TimelineMaterials | null>(null)

  // 開いたとき・サーバから読み直したとき・Take ができたときに取り直す。
  useEffect(() => {
    let cancelled = false
    void loadTimelineMaterials(workbench.projectId).then((loaded) => {
      if (!cancelled) setMaterials(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [workbench.projectId, workbench.serverEpoch, workbench.posterEpoch])

  if (materials === null) {
    return (
      <PanelFrame>
        <p className="text-sm text-muted">タイムラインを読み込んでいます…</p>
      </PanelFrame>
    )
  }

  const mine = transport.owner === 'monitor'

  return (
    <PanelFrame>
      <TimelineEditor
        projectId={workbench.projectId}
        shots={workbench.shots}
        initialTransitions={materials.transitions.value}
        initialClips={materials.clips.value}
        renderedShotIds={renderedShotIdsOf(materials)}
        documentDurationSec={materials.document.value?.durationSec ?? null}
        initialDocument={materials.document.value}
        initialIssues={materials.issues.value}
        beatSource={materials.beatSource}
        beatAlignment={materials.beatAlignment.value}
        loadErrors={timelineLoadErrors(materials)}
        showMonitor={false}
        collapseAuxiliary
        posters={workbench.posters}
        selectedShotId={workbench.selectedShotId}
        onSelectShot={workbench.selectShot}
        initialSnapEnabled={preferences.playback.snapToBeat}
        playback={{
          currentSec: transport.currentSec,
          playing: transport.playing && mine,
          seek: transport.seek,
          onSeek: transportControls.seekTo,
          onFrame: transportControls.setCurrentSec,
          onPlayingChange: (next) => {
            if (next) transportControls.play('monitor')
            else transportControls.pause()
          },
        }}
      />
    </PanelFrame>
  )
}
