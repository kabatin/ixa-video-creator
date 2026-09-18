'use client'

import { useEffect, useState } from 'react'
import { ProgramMonitor } from '@/components/program-monitor'
import { useWorkbench } from '@/components/workbench/workbench-context'
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
      {loadError !== null && <PanelNotice tone="danger">{loadError}</PanelNotice>}
      {monitorError !== null && <PanelNotice tone="warn">{`モニター: ${monitorError}`}</PanelNotice>}
      <div className="mx-auto w-full max-w-5xl">
        <ProgramMonitor
          document={loaded}
          currentSec={transport.currentSec}
          seek={transport.seek}
          playing={playing}
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
    </PanelFrame>
  )
}
