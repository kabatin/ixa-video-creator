'use client'

import { useEffect, useRef } from 'react'
import type { AudioPlayback } from '@/lib/use-audio-playback'
import type { SeekCommand } from '@/lib/program-monitor'

/** `cut-editor` の `CutEditorSync` と同じ形。循環 import を避けてここにも型を置く。 */
export type TransportSyncPort = {
  readonly othersPlaying: boolean
  readonly seek: SeekCommand | null
  readonly onPosition: (sec: number) => void
  readonly onPlayingChange: (playing: boolean) => void
}

/**
 * 聴きながら切るの再生器をワークベンチの再生位置と繋ぐ（UI-WORKBENCH §7.2）。
 *
 * - **変化だけを報告する。** 取り付けた瞬間の「停止中・0 秒」を報告すると、
 *   プレビューで止めていた位置を 0 へ潰し、鳴っている映像まで止めてしまう
 * - 他が鳴り始めたら止まる（同時に鳴るのは 1 つだけ）
 * - 明示的に飛んだ指示（`seek.serial` が変わる）だけを追う。位置の報告と往復させない（L-023）
 */
export const useCutEditorSync = (
  playback: AudioPlayback,
  sync: TransportSyncPort | undefined,
): void => {
  const port = useRef(sync)
  port.current = sync
  const control = useRef(playback)
  control.current = playback

  const wasPlaying = useRef(playback.isPlaying)
  useEffect(() => {
    if (wasPlaying.current === playback.isPlaying) return
    wasPlaying.current = playback.isPlaying
    port.current?.onPlayingChange(playback.isPlaying)
  }, [playback.isPlaying])

  const lastSec = useRef(playback.currentSec)
  useEffect(() => {
    if (lastSec.current === playback.currentSec) return
    lastSec.current = playback.currentSec
    // 他が鳴っている間は位置を返さない。両方が返すと位置が往復する（L-023）。
    if (port.current?.othersPlaying !== true) port.current?.onPosition(playback.currentSec)
  }, [playback.currentSec])

  const othersPlaying = sync?.othersPlaying ?? false
  useEffect(() => {
    if (othersPlaying && control.current.isPlaying) control.current.pause()
  }, [othersPlaying])

  const seekSerial = sync?.seek?.serial ?? null
  const seenSerial = useRef(seekSerial)
  useEffect(() => {
    if (seekSerial === seenSerial.current) return
    seenSerial.current = seekSerial
    const seek = port.current?.seek
    if (seek !== null && seek !== undefined) control.current.seekTo(seek.sec)
  }, [seekSerial])
}
