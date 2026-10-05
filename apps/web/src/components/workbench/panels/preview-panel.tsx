'use client'

import { useEffect, useRef, useState } from 'react'
import { ProgramMonitor } from '@/components/program-monitor'
import { useSelectedShot, useTransport, useWorkbench } from '@/components/workbench/workbench-context'
import { PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { TransportBar } from '@/components/workbench/transport-bar'
import { loadTimelineDocument, type Part } from '@/lib/timeline-loader'
import type { WireTimelineDocument } from '@/lib/timeline-api'
import { timelineShotsKey } from '@/lib/timeline-shots-key'

/**
 * プレビュー（中央上）。Program Monitor 1 枚（D7）。
 *
 * **書き出しと同じ TimelineDocument を同じコンポジションで再生する。**
 * 再生位置はワークベンチの 1 箇所（`transport`）を見る。タイムラインの再生ヘッドも同じ値。
 *
 * **ここは映すだけで、再生の操作は持たない。** 以前はこのパネルにも「再生」があり、
 * 「聴きながら切る」を開いていると同じ見た目のボタンが縦に 2 つ並んでいた。
 * どちらが何を鳴らすのか区別が無く、押す側は選べない。操作は下の帯に 1 つだけ置く。
 * 鳴らしているのが自分でないときは、絵だけ共有の位置へ合わせる（`followSec`）。
 */
export const PreviewPanel = ({ visible = true }: { readonly visible?: boolean }) => {
  const workbench = useWorkbench()
  const { transportControls } = workbench
  const transport = useTransport()
  const shot = useSelectedShot()
  const [document, setDocument] = useState<Part<WireTimelineDocument> | null>(null)
  const [monitorError, setMonitorError] = useState<string | null>(null)

  // Take ができた・サーバから読み直した・Shot の尺や採用を変えた・ナレーションが変わったときに組み立て直す。
  // ナレーション（ADR-0038）は声の位置が組み立て結果の音に入る。入れ忘れると、帯では動いたのに鳴る位置が変わらない。
  const shotsKey = timelineShotsKey(workbench.shots)
  useEffect(() => {
    let cancelled = false
    void loadTimelineDocument(workbench.projectId).then((loaded) => {
      if (!cancelled) setDocument(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [workbench.projectId, workbench.posterEpoch, workbench.serverEpoch, workbench.narrationEpoch, shotsKey])

  /**
   * 選んだ Shot の頭へ移る。
   *
   * プレビューは共有の選択を一度も読んでいなかったため、Shot を選んでも絵は動かず、
   * 見たい Shot を出すにはタイムラインの目盛りを手で押しにいくしかなかった。
   *
   * **開いた直後は動かさない。** その 1 回で頭出しすると、前に見ていた位置が失われる。
   * **鳴っている間も動かさない。** 再生中に選択が変わるたび飛ぶのは邪魔でしかない。
   */
  /**
   * 操作列に「自分は画面にいる」と名乗る。
   *
   * **依存は `registerPlayer` だけにする。** `transportControls` 全体に依存すると、
   * `host` がその中にあるため「登録 → host が変わる → controls の同一性が変わる →
   * 登録解除して登録し直す」が回り続け、誰も登録されていない状態に落ち着く
   * （実機で再生ボタンが 1 つも出なくなった）。
   */
  const { registerPlayer } = transportControls
  useEffect(() => (visible ? registerPlayer('monitor') : undefined), [registerPlayer, visible])

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
    <PanelFrame>
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
            // 自分が鳴らしていない間も、絵は共有の位置へ付いていく。
            followSec={mine ? null : transport.currentSec}
            // パネルを縦に縮めても絵が全部見えるよう、幅と高さの両方に収める。
            fit="contain"
            // 絵がまだ無くても、音とテロップは黒い画面で流す（制作者 2026-10-03「テロップだけ確認は必須かも」）。
            withoutPictures
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
        {/* 再生の操作はプレイヤーの直下。画面にひとつだけ（`transport-bar.tsx`）。 */}
        <TransportBar owner="monitor" durationSec={loaded?.durationSec ?? null} />
      </div>
    </PanelFrame>
  )
}
