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
  /**
   * 「自分が鳴っているべきか」の指示。**再生ボタンが画面にひとつしかないため要る。**
   *
   * 以前はこのパネルの中のボタンだけが再生を始められたので、外からは鳴らせなかった。
   * 下の帯のボタンを押したときに鳴り出すよう、指示として受け取る。
   * `null` は「指示しない」（このパネル単体で使うとき）。
   */
  readonly commandPlaying?: boolean | null
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

  /**
   * 外からの再生指示に従う。**すでにその状態なら何もしない。**
   * 自分の報告が `onPlayingChange` → 指示として返ってくるので、
   * 比べずに実行すると止めた直後に鳴り直す。
   */
  const commandPlaying = sync?.commandPlaying ?? null
  useEffect(() => {
    if (commandPlaying === null) return
    if (commandPlaying && !control.current.isPlaying) void control.current.play()
    if (!commandPlaying && control.current.isPlaying) control.current.pause()
  }, [commandPlaying])

  const seekSerial = sync?.seek?.serial ?? null
  const seenSerial = useRef(seekSerial)
  useEffect(() => {
    if (seekSerial === seenSerial.current) return
    seenSerial.current = seekSerial
    const seek = port.current?.seek
    if (seek !== null && seek !== undefined) control.current.seekTo(seek.sec)
  }, [seekSerial])
}
