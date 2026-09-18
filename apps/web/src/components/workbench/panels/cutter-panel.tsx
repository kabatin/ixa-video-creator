'use client'

import { CutEditor } from '@/components/cut-editor'
import { usePreferences } from '@/components/preferences-root'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { MusicGate } from '@/components/workbench/panels/music-gate'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'

/**
 * 聴きながら切る（中央下）。中身は既存の `cut-editor`。
 *
 * - 打鍵を受けるのは**見えている間だけ**（`visible`）。裏のタブが Space を横取りしない（L-018）
 * - 再生位置はワークベンチと共有する。鳴らし始めたらプレビューは止まる（UI-WORKBENCH §7.2）
 */
export const CutterPanel = ({ visible }: { readonly visible: boolean }) => {
  const workbench = useWorkbench()
  const { preferences } = usePreferences()
  const { transport, transportControls } = workbench
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
            sync={{
              othersPlaying: transport.playing && transport.owner !== 'cutter',
              seek: transport.seek,
              onPosition: transportControls.setCurrentSec,
              onPlayingChange: (playing) => {
                if (playing) transportControls.play('cutter')
                else if (transport.owner === 'cutter') transportControls.pause()
              },
            }}
          />
        )}
      </MusicGate>
    </PanelFrame>
  )
}
