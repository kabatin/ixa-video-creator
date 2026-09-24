'use client'

import { useCallback, useMemo, useState } from 'react'
import { nextSeekCommand } from '@/lib/program-monitor'
import type {
  TransportControls,
  TransportOwner,
  WorkbenchTransport,
} from '@/components/workbench/workbench-context'

/**
 * ワークベンチの再生位置（UI-WORKBENCH §7.2）。
 *
 * **位置は 1 つ、鳴らすのは 1 つ。** 聴きながら切る（音だけ）とプレビュー（映像＋音）は
 * 別の再生器を持つが、見ている位置は同じ値にする。再生を始めた側が `owner` になり、
 * もう片方は `owner` が自分でなければ止まる。両方が同時に鳴ると音がずれて重なる。
 */
const INITIAL: WorkbenchTransport = Object.freeze({
  currentSec: 0,
  playing: false,
  seek: null,
  owner: null,
})

export const useWorkbenchTransport = (): {
  readonly transport: WorkbenchTransport
  readonly controls: TransportControls
} => {
  const [transport, setTransport] = useState<WorkbenchTransport>(INITIAL)

  const setCurrentSec = useCallback((sec: number): void => {
    setTransport((current) =>
      current.currentSec === sec ? current : { ...current, currentSec: sec },
    )
  }, [])

  const seekTo = useCallback((sec: number): void => {
    setTransport((current) => ({
      ...current,
      currentSec: sec,
      seek: nextSeekCommand(current.seek, sec),
    }))
  }, [])

  /**
   * 持ち主を替えて鳴らす。**新しい側を共有の位置へ連れて行く。**
   *
   * 再生器は自分の位置を自分で覚えていて、外の位置は明示的な `seek` のときしか追わない
   * （位置が双方向に流れるのを防ぐため。lessons L-023）。そのため持ち主が替わると、
   * 新しい側は**自分が最後にいたコマ**から鳴り出していた。
   * プレビューを 0:50 で止めてカッターへ移ると 0:00 に巻き戻り、
   * そこに区切りが入る。持ち主が替わる瞬間だけは、こちらから位置を渡す。
   */
  const handOver = (current: WorkbenchTransport, owner: TransportOwner): WorkbenchTransport =>
    current.owner === owner
      ? { ...current, playing: true, owner }
      : {
          ...current,
          playing: true,
          owner,
          seek: nextSeekCommand(current.seek, current.currentSec),
        }

  const play = useCallback((owner: TransportOwner): void => {
    setTransport((current) => handOver(current, owner))
  }, [])

  const pause = useCallback((): void => {
    setTransport((current) => (current.playing ? { ...current, playing: false } : current))
  }, [])

  /** そのパネルの再生ボタン。自分が鳴っていれば止め、そうでなければ自分が鳴る。 */
  const toggle = useCallback((owner: TransportOwner): void => {
    setTransport((current) =>
      current.playing && current.owner === owner
        ? { ...current, playing: false }
        : handOver(current, owner),
    )
  }, [])

  /**
   * 画面共通の 1 打（Space）。**鳴っている間は必ず止める。持ち主が誰であっても。**
   *
   * `toggle(owner)` をそのまま割り当てると、裏のタブで鳴っているときに
   * 「止める」ではなく「別の場所を鳴らし始める」になる。止めるつもりの 1 打で
   * 曲の違う場所が鳴り出すのは、操作としてまず通じない。
   */
  const togglePlayback = useCallback((fallbackOwner: TransportOwner): void => {
    setTransport((current) =>
      current.playing
        ? { ...current, playing: false }
        : handOver(current, current.owner ?? fallbackOwner),
    )
  }, [])

  const controls = useMemo(
    () => ({ setCurrentSec, seekTo, play, pause, toggle, togglePlayback }),
    [setCurrentSec, seekTo, play, pause, toggle, togglePlayback],
  )

  return { transport, controls }
}
