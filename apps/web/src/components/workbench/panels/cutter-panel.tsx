'use client'

import type { MusicTrack } from '@ixa/domain'
import { useEffect, useRef, useState } from 'react'
import { CutEditor } from '@/components/cut-editor'
import { StoryboardPanel as AutoSplit } from '@/components/storyboard-panel'
import { Button } from '@/components/ui/button'
import type { WireMusicAnalysis } from '@/lib/music-api'
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
            // 再生ボタンを出すのは、いま操作列を持っているパネルだけ。
            showPlay={transportControls.host === 'cutter'}
            toolbarExtra={<AutoSplitPopover track={track} analysis={analysis} />}
            sync={{
              othersPlaying: transport.playing && transport.owner !== 'cutter',
              seek: transport.seek,
              onPosition: transportControls.setCurrentSec,
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

/**
 * セクションから粗く割る補助（UI-WORKBENCH-2 §6 / Q4）。**独立したタブにしない。**
 * 主の操作は聴きながら切るなので、その操作の行から吹き出しで開く。
 */
const AutoSplitPopover = ({
  track,
  analysis,
}: {
  readonly track: MusicTrack
  readonly analysis: WireMusicAnalysis
}) => {
  const workbench = useWorkbench()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || ref.current?.contains(event.target) !== true)
        setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button size="sm" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        セクションから割る…
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="セクションから割る"
          className="absolute left-0 top-full z-40 mt-1 w-[min(36rem,80vw)] rounded-md border border-line bg-surface p-3 shadow-xl"
        >
          <p className="mb-2 text-xs text-muted">
            解析のセクションから粗く割る補助です。主の操作は波形の上で区切りを置くことです。
          </p>
          <AutoSplit
            projectId={workbench.projectId}
            track={track}
            analysis={analysis}
            sequences={workbench.sequences}
          />
        </div>
      )}
    </div>
  )
}
