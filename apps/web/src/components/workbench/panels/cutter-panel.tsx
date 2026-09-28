'use client'

import { useEffect } from 'react'
import { CutEditor } from '@/components/cut-editor'
import { usePreferences } from '@/components/preferences-root'
import { useTransport, useWorkbench } from '@/components/workbench/workbench-context'
import { MusicGate } from '@/components/workbench/panels/music-gate'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import { TransportButtons } from '@/components/workbench/transport-buttons'

/**
 * 聴きながら切る（中央下）。中身は既存の `cut-editor`。
 *
 * - 打鍵を受けるのは**見えている間だけ**（`visible`）。裏のタブが Space を横取りしない（L-018）
 * - 再生位置はワークベンチと共有する。鳴らし始めたらプレビューは止まる（UI-WORKBENCH §7.2）
 */
export const CutterPanel = ({ visible }: { readonly visible: boolean }) => {
  const workbench = useWorkbench()
  const { preferences } = usePreferences()
  const { transportControls } = workbench
  const transport = useTransport()

  // 操作列に名乗る。**依存は registerPlayer だけ**（preview-panel に理由を書いた）。
  const { registerPlayer } = transportControls
  useEffect(() => (visible ? registerPlayer('cutter') : undefined), [registerPlayer, visible])

  return (
    <PanelFrame>
      <MusicGate>
        {({ track, analysis }) => (
          <CutEditor
            projectId={workbench.projectId}
            track={track}
            analysis={analysis}
            sequences={workbench.sequences}
            initialSnapEnabled={preferences.playback.snapToBeat}
            keyboardShortcuts={visible && workbench.dialog === null}
            // プレビューの下と同じ操作列。波形の直下に置くので、押せばこのパネルが鳴るのは場所で分かる
            // （2026-09-28、制作者の提案で両方に置く）。見た目も「いま何か鳴っているか」の読み方も揃える。
            playButton={<TransportButtons owner="cutter" durationSec={analysis.durationSec} />}
            sync={{
              othersPlaying: transport.playing && transport.owner !== 'cutter',
              seek: transport.seek,
              onPosition: transportControls.setCurrentSec,
              // 波形・スライダーで飛んだら、鳴っているのがプレビューでもそこへ飛ぶ。
              onSeek: transportControls.seekTo,
              onPlayingChange: (playing) => {
                if (playing) transportControls.play('cutter')
                else if (transport.owner === 'cutter') transportControls.pause()
              },
              // 操作列のボタンで鳴らせるようにする。自分が持ち主のときだけ従う。
              commandPlaying: transport.owner === 'cutter' ? transport.playing : null,
              /**
               * 自分が鳴らしていない間も、波形の再生位置は共有の位置へ付いていく。
               * 付いていかないと、プレビューが鳴っている間だけ波形の線が止まり、
               * 絵と波形で別の場所を指すことになる（モニター側で直したのと同じ食い違い）。
               */
              followSec: transport.owner === 'cutter' ? null : transport.currentSec,
            }}
          />
        )}
      </MusicGate>
    </PanelFrame>
  )
}
