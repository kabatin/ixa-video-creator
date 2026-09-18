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
    setTransport((current) => (current.currentSec === sec ? current : { ...current, currentSec: sec }))
  }, [])

  const seekTo = useCallback((sec: number): void => {
    setTransport((current) => ({
      ...current,
      currentSec: sec,
      seek: nextSeekCommand(current.seek, sec),
    }))
  }, [])

  const play = useCallback((owner: TransportOwner): void => {
    setTransport((current) => ({ ...current, playing: true, owner }))
  }, [])

  const pause = useCallback((): void => {
    setTransport((current) => (current.playing ? { ...current, playing: false } : current))
  }, [])

  const toggle = useCallback((owner: TransportOwner): void => {
    setTransport((current) =>
      current.playing && current.owner === owner
        ? { ...current, playing: false }
        : { ...current, playing: true, owner },
    )
  }, [])

  const controls = useMemo(
    () => ({ setCurrentSec, seekTo, play, pause, toggle }),
    [setCurrentSec, seekTo, play, pause, toggle],
  )

  return { transport, controls }
}
