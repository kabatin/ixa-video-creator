'use client'

import type { MusicTrackId, Shot } from '@ixa/domain'
import { TimelineEditor } from '@/components/timeline-editor'
import { TIMELINE_LANE_HEIGHT_PX } from '@/lib/timeline-display'
import { musicEndMark } from '@/lib/music-end-mark'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { useFreshWaveformPeaks } from '@/lib/fresh-waveform-peaks'
import type { WaveformPeaksResult } from '@/lib/waveform-api'
import { sectionBoundaries } from '@/lib/waveform-draw'
import { usePreferences } from '@/components/preferences-root'
import { useTransportState, useWorkbench } from '@/components/workbench/workbench-context'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import { useConsoleLog } from '@/components/workbench/console-log-context'
import { renderedShotIdsOf, timelineLoadErrors } from '@/lib/timeline-loader'
import { useTimelineMaterials } from '@/components/workbench/timeline-materials-provider'
import { useContextMenuTrigger } from '@/components/workbench/use-context-menu'
import { useShotMenu } from '@/components/workbench/use-shot-menu'
import { useTextClipMenu } from '@/components/workbench/use-text-clip-menu'
import { useTimelineAudio } from '@/components/workbench/narration/use-timeline-audio'
import { useTimelineMotionMarks } from '@/components/workbench/use-timeline-motion-marks'

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
  const consoleLog = useConsoleLog()
  const { transportControls } = workbench
  const transport = useTransportState()
  const peaks = useTrackPeaks(workbench.track?.id ?? null, workbench.analysis?.waveformPeaksUrl ?? null)
  // 材料はワークベンチに 1 つ（検査のタブと同じもの）。効果音を置いたら取り直す（サーバの読み直しを通らないため）。
  const { materials, reload } = useTimelineMaterials()
  const { narrationLane, onDropAudio, onDropSfxAsset } = useTimelineAudio(reload)
  // 動きの分析の印（ADR-0054）。「効果音を作る」窓を閉じたら読み直す（そこで分析が終わっていることが多い）。
  const motionMarks = useTimelineMotionMarks(workbench.shots, workbench.dialog === null)

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
              heightPx={TIMELINE_LANE_HEIGHT_PX}
              endMark={workbench.track === null ? null : musicEndMark(workbench.track, analysis.durationSec)}
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
        beatSource={materials.beatSource}
        lyricCues={workbench.project.lyricCues}
        beatAlignment={materials.beatAlignment.value}
        loadErrors={timelineLoadErrors(materials)}
        showMonitor={false}
        // 操作の結果はコンソールへ。失敗は上の 1 行の知らせにも出す（帯の上に積んで押し下げない）。
        onLog={(level, message) => {
          if (level === 'error') workbench.notify(message, 'error')
          else consoleLog?.push('info', message)
        }}
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
        onOpenTextClip={(id, options) => {
          workbench.inspect({ kind: 'text-clip', id, ...(options?.focusText === true ? { focusText: true } : {}) })
          workbench.focusPanel('inspector')
        }}
        // 効果音もインスペクターで開く（位置・音量）。
        onOpenMediaClip={(id) => {
          workbench.inspect({ kind: 'audio-clip', id })
          workbench.focusPanel('inspector')
        }}
        // エフェクトもインスペクターで開く（型・強さ・位置・長さ。ADR-0050）。
        onOpenEffectClip={(id) => {
          workbench.inspect({ kind: 'effect-clip', id })
          workbench.focusPanel('inspector')
        }}
        // 再生位置の Shot（無ければ選んでいる Shot）の効果音を作る（ADR-0054）。
        onMakeSfx={(atSec) => {
          const under = workbench.shots?.find((shot) => atSec >= shot.startSec && atSec < shot.startSec + shot.durationSec)
          workbench.openDialog('make-sfx', under === undefined ? {} : { shotIds: [under.id] })
        }}
        motionMarks={{
          marks: motionMarks,
          onPlayFrom: (sec) => {
            transportControls.seekTo(sec)
            transportControls.play('monitor')
          },
        }}
        {...(audioLane === null ? {} : { audioLane })}
        narrationLane={narrationLane}
        onDropAudio={onDropAudio}
        onDropSfxAsset={onDropSfxAsset}
        // 効果音のクリップを帯で動かした・切った・消したら、素材ツリーの効果音（置いた位置）を取り直す。
        onClipChanged={(track) => {
          if (track === 'SFX') workbench.bumpSfx()
        }}
        initialSnapEnabled={preferences.playback.snapToBeat}
        // 聴きながら切るで鳴らしていても位置は動く。「再生位置を追う」は、どこかが鳴っていれば帯を流す。
        playheadMoving={transport.playing}
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
 * 楽曲の波形の点。**取る直前に解析を引き直して、その URL で取る**（`fresh-waveform-peaks.ts`）。
 * ページを描いたときの URL（期限 300 秒）で取ると、開いて 5 分を過ぎたパネルでは帯が消えた。
 * 取れなければ帯を出さない（読めない理由はカッター側が出す）。
 */
const useTrackPeaks = (
  trackId: MusicTrackId | null,
  analysisKey: string | null,
): WaveformPeaksResult | null => {
  const peaks = useFreshWaveformPeaks(analysisKey === null ? null : trackId, analysisKey)
  return peaks === null || peaks.status === 'failed' ? null : peaks
}
