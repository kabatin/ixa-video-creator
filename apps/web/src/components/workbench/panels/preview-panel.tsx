'use client'

import { useEffect, useRef, useState } from 'react'
import { ProgramMonitor } from '@/components/program-monitor'
import { useSelectedShot, useWorkbench } from '@/components/workbench/workbench-context'
import { PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/format-time'
import { loadTimelineDocument, type Part } from '@/lib/timeline-loader'
import type { WireTimelineDocument } from '@/lib/timeline-api'

/**
 * プレビュー（中央上）。Program Monitor 1 枚（D7）。
 *
 * **書き出しと同じ TimelineDocument を同じコンポジションで再生する。**
 * 再生位置はワークベンチの 1 箇所（`transport`）を見る。タイムラインの再生ヘッドも同じ値。
 * 聴きながら切るが鳴っている間はこちらは止まる（同時に鳴るのは 1 つだけ）。
 */
export const PreviewPanel = () => {
  const workbench = useWorkbench()
  const { transport, transportControls } = workbench
  const shot = useSelectedShot()
  const [document, setDocument] = useState<Part<WireTimelineDocument> | null>(null)
  const [monitorError, setMonitorError] = useState<string | null>(null)

  // Take ができた・サーバから読み直したときに組み立て直す。
  useEffect(() => {
    let cancelled = false
    void loadTimelineDocument(workbench.projectId).then((loaded) => {
      if (!cancelled) setDocument(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [workbench.projectId, workbench.posterEpoch, workbench.serverEpoch])

  /**
   * 選んだ Shot の頭へ移る。
   *
   * プレビューは共有の選択を一度も読んでいなかったため、Shot を選んでも絵は動かず、
   * 見たい Shot を出すにはタイムラインの目盛りを手で押しにいくしかなかった。
   *
   * **開いた直後は動かさない。** その 1 回で頭出しすると、前に見ていた位置が失われる。
   * **鳴っている間も動かさない。** 再生中に選択が変わるたび飛ぶのは邪魔でしかない。
   */
  const movedToRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (shot === null) return
    if (movedToRef.current === undefined) {
      movedToRef.current = shot.id
      return
    }
    if (movedToRef.current === shot.id) return
    movedToRef.current = shot.id
    if (transport.playing) return
    transportControls.seekTo(shot.startSec)
  }, [shot, transport.playing, transportControls])

  const loaded = document?.value ?? null
  const loadError = document?.error ?? null
  const mine = transport.owner === 'monitor'
  const playing = transport.playing && mine

  return (
    <PanelFrame
      toolbar={
        <>
          <Button
            size="sm"
            tone="primary"
            disabled={loaded === null}
            aria-pressed={playing}
            onClick={() => {
              transportControls.toggle('monitor')
            }}
          >
            {playing ? '一時停止' : '再生'}
          </Button>
          <span className="tabular-nums text-muted" aria-live="off">
            {formatClock(transport.currentSec)}
            {loaded !== null && ` / ${formatClock(loaded.durationSec)}`}
          </span>
        </>
      }
    >
      {/**
       * パネルの高さいっぱいを絵に使う。知らせは上に積み、残り全部をモニターへ渡す。
       * 幅で頭打ちにしない（`max-w-*` を置くと、広いパネルで絵が伸びない）。
       */}
      <div className="flex h-full min-h-0 flex-col">
        {loadError !== null && <PanelNotice tone="danger">{loadError}</PanelNotice>}
        {monitorError !== null && (
          <PanelNotice tone="warn">{`モニター: ${monitorError}`}</PanelNotice>
        )}
        <div className="min-h-0 flex-1">
          <ProgramMonitor
            document={loaded}
            currentSec={transport.currentSec}
            seek={transport.seek}
            playing={playing}
            // パネルを縦に縮めても絵が全部見えるよう、幅と高さの両方に収める。
            fit="contain"
            // 位置を返すのは自分が鳴らしている間だけ。両方が返すと位置が往復する（L-023）。
            onFrame={(sec) => {
              if (mine) transportControls.setCurrentSec(sec)
            }}
            onPlayingChange={(next) => {
              if (next) transportControls.play('monitor')
              else if (mine) transportControls.pause()
            }}
            onError={setMonitorError}
          />
        </div>
      </div>
    </PanelFrame>
  )
}
