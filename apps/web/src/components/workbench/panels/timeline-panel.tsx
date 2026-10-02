'use client'

import type { Shot } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { TimelineEditor } from '@/components/timeline-editor'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'
import { sectionBoundaries } from '@/lib/waveform-draw'
import { usePreferences } from '@/components/preferences-root'
import { useTransportState, useWorkbench } from '@/components/workbench/workbench-context'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import {
  loadTimelineMaterials,
  renderedShotIdsOf,
  timelineLoadErrors,
  type TimelineMaterials,
} from '@/lib/timeline-loader'
import { timelineShotsKey } from '@/lib/timeline-shots-key'
import { useContextMenuTrigger } from '@/components/workbench/use-context-menu'
import { useShotMenu } from '@/components/workbench/use-shot-menu'
import { useTextClipMenu } from '@/components/workbench/use-text-clip-menu'

/**
 * タイムライン（中央下）。中身は既存の `timeline-editor`。
 *
 * **モニターは持たない。** 再生位置はワークベンチの 1 箇所を見て、絵はプレビューのパネルに出す
 * （UI-WORKBENCH §3.1）。材料はこのパネルが自分で取る（§7.3）。
 */
export const TimelinePanel = () => {
  const workbench = useWorkbench()
  // Shot の右クリック（長押し・Shift+F10）のメニュー。
  const shotMenuActions = useShotMenu()
  const textClipMenu = useTextClipMenu()
  const shotMenu = useContextMenuTrigger<Shot>((shot, at, origin) => {
    shotMenuActions.open(shot, at, origin)
  })
  const { preferences } = usePreferences()
  const { transportControls } = workbench
  const transport = useTransportState()
  const [materials, setMaterials] = useState<TimelineMaterials | null>(null)
  const peaks = useTrackPeaks(workbench.analysis?.waveformPeaksUrl ?? null)

  // 開いたとき・サーバから読み直したとき・Take ができたとき・Shot の尺や採用を変えたときに取り直す。
  const shotsKey = timelineShotsKey(workbench.shots)
  useEffect(() => {
    let cancelled = false
    void loadTimelineMaterials(workbench.projectId).then((loaded) => {
      if (!cancelled) setMaterials(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [workbench.projectId, workbench.serverEpoch, workbench.posterEpoch, shotsKey])

  if (materials === null) {
    return (
      <PanelFrame>
        <p className="text-sm text-muted">タイムラインを読み込んでいます…</p>
      </PanelFrame>
    )
  }

  const mine = transport.owner === 'monitor'
  const analysis = workbench.analysis
  const audioLane =
    analysis === null || peaks === null
      ? null
      : {
          durationSec: analysis.durationSec,
          node: (
            <WaveformCanvas
              peaks={peaks}
              durationSec={analysis.durationSec}
              beats={analysis.beats}
              downbeats={analysis.downbeats}
              drops={analysis.drops}
              sectionBoundarySec={sectionBoundaries(analysis.sections)}
              heightPx={44}
              compact
            />
          ),
        }

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
        lyricCues={workbench.project.lyricCues}
        beatAlignment={materials.beatAlignment.value}
        loadErrors={timelineLoadErrors(materials)}
        showMonitor={false}
        collapseAuxiliary
        posters={workbench.posters}
        selectedShotId={workbench.selectedShotId}
        onSelectShot={workbench.selectShot}
        shotContextMenu={shotMenu}
        // 帯のテロップの右クリック（長押し）のメニュー（2026-09-30）。
        onTextClipContextMenu={(id, at, origin) => {
          const clip = (materials.clips.value ?? []).find((candidate) => candidate.id === id)
          if (clip !== undefined) textClipMenu.open(clip, at, origin)
        }}
        // 帯のテロップは小窓でなくインスペクターで開く（小窓は見切れて編集しづらい）。
        onOpenTextClip={(id) => {
          workbench.inspect({ kind: 'text-clip', id })
          workbench.focusPanel('inspector')
        }}
        {...(audioLane === null ? {} : { audioLane })}
        initialSnapEnabled={preferences.playback.snapToBeat}
        playback={{
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

/**
 * 楽曲の波形の点。解析の署名付き URL は期限があるので、**開いたときに 1 回だけ**取る
 * （URL を持ち回さない。規約 7）。取れなければ帯を出さない（読めない理由はカッター側が出す）。
 */
const useTrackPeaks = (url: string | null): WaveformPeaksResult | null => {
  const [peaks, setPeaks] = useState<WaveformPeaksResult | null>(null)
  useEffect(() => {
    if (url === null) return undefined
    let cancelled = false
    void fetchWaveformPeaks(url).then((result) => {
      if (!cancelled) setPeaks(result.status === 'failed' ? null : result)
    })
    return () => {
      cancelled = true
    }
  }, [url])
  return peaks
}
