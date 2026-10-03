'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { resolveSeekTarget } from '@/lib/playback-state'
import type { AudioPlayback } from '@/lib/use-audio-playback'
import type { SeekCommand } from '@/lib/program-monitor'

/** これ以下の差では合わせ直さない。止まっている要素への seek を毎フレーム出さない。 */
const FOLLOW_TOLERANCE_SEC = 0.05

/** `cut-editor` の `CutEditorSync` と同じ形。循環 import を避けてここにも型を置く。 */
export type TransportSyncPort = {
  readonly othersPlaying: boolean
  readonly seek: SeekCommand | null
  readonly onPosition: (sec: number) => void
  /**
   * 利用者が**ここで**飛んだ（波形・再生位置のスライダー・印へのジャンプ・キー）。
   * 共有の位置へのシークとして伝える。省略なら伝えない（このパネル単体で使うとき）。
   */
  readonly onSeek?: (sec: number) => void
  readonly onPlayingChange: (playing: boolean) => void
  /**
   * 「自分が鳴っているべきか」の指示。**再生ボタンが画面にひとつしかないため要る。**
   *
   * 以前はこのパネルの中のボタンだけが再生を始められたので、外からは鳴らせなかった。
   * 下の帯のボタンを押したときに鳴り出すよう、指示として受け取る。
   * `null` は「指示しない」（このパネル単体で使うとき）。
   */
  readonly commandPlaying?: boolean | null
  /**
   * 自分が鳴らしていないときに、再生位置だけ合わせにいく秒。
   * 別のパネルが鳴らしている間、波形の線が止まって絵と食い違うのを防ぐ。
   * `null` / 省略なら追従しない。
   */
  readonly followSec?: number | null
}

/**
 * 聴きながら切るの再生器をワークベンチの再生位置と繋ぐ（UI-WORKBENCH §7.2）。
 *
 * - **変化だけを報告する。** 取り付けた瞬間の「停止中・0 秒」を報告すると、
 *   プレビューで止めていた位置を 0 へ潰し、鳴っている映像まで止めてしまう
 * - 他が鳴り始めたら止まる（同時に鳴るのは 1 つだけ）
 * - 明示的に飛んだ指示（`seek.serial` が変わる）だけを追う。位置の報告と往復させない（L-023）
 * - **利用者の操作に使う `seekTo` / `nudge` を返す。** 自分の再生器を動かし、共有の位置へも飛ばす。
 *   以前は自分の中だけで動かしていたので、プレビューが鳴っている間は `followSec` で
 *   鳴っている位置へ引き戻され、ガタついて見えた（2026-09-28、制作者の指摘）。
 *   付いていく動き（`followSec` / `seek`）は生の再生器で行い、伝え返さない
 */
export const useCutEditorSync = (
  playback: AudioPlayback,
  sync: TransportSyncPort | undefined,
): AudioPlayback => {
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

  /** 外した後に届いた位置の報告を捨てる。 */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const lastSec = useRef(playback.currentSec)
  useEffect(() => {
    if (lastSec.current === playback.currentSec) return
    lastSec.current = playback.currentSec
    const sec = playback.currentSec
    /**
     * **位置の報告は effect の flush の外で渡す**（`program-monitor-player.tsx` と同じ）。
     * ここで共有の位置を同期的に更新すると、React は毎フレーム「effect の flush 中の更新」と数え、
     * 描画が遅いと途切れずに積もって、開発時に `Maximum update depth exceeded` が出た
     * （制作者 2026-10-04。CPU を 6 倍絞って 25 秒鳴らすと 4 件）。マイクロタスクなら位置は同じ順番で、ほぼ遅れずに届く。
     */
    queueMicrotask(() => {
      if (!mounted.current) return
      // 他が鳴っている間は位置を返さない。両方が返すと位置が往復する（L-023）。
      if (port.current?.othersPlaying !== true) port.current?.onPosition(sec)
    })
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

  /**
   * 共有の位置へ付いていく。**鳴らしているときは合わせない**（位置が往復する。L-023）。
   *
   * **他が鳴っている間は再生器を動かさず、見せる位置だけ付いていく**（下の `shownSec`）。
   * 以前は止まっている音声を 1 秒に 8 回ほど頭出しし直し、そのたびに読み込みと描き直しが走って
   * 主スレッドが詰まり、鳴っているプレビューの音が巻き戻った（2026-09-28 実測）。
   * 再生器を合わせるのは、他が止まっているときの移動（と止まった瞬間）だけ。
   */
  const followSec = sync?.followSec ?? null
  useEffect(() => {
    if (followSec === null || othersPlaying) return
    if (control.current.isPlaying) return
    if (Math.abs(control.current.currentSec - followSec) < FOLLOW_TOLERANCE_SEC) return
    control.current.seekTo(followSec)
  }, [followSec, othersPlaying])
  /**
   * 見せる位置。他が鳴っている間に加えて、**自分が止まっている間も共有の位置**を見せる。
   * 他が止まった瞬間は再生器の頭出しが遅れて終わるので、再生器の古い位置（鳴らし始めた所）を見せると
   * バーが一瞬戻って見えた（制作者 2026-10-02「進捗バーがジッターおこした」）。自分が鳴らすときは `followSec` が null。
   */
  const shownSec =
    followSec !== null && (othersPlaying || !playback.isPlaying) ? followSec : playback.currentSec
  const shown = useRef(shownSec)
  shown.current = shownSec

  const seekSerial = sync?.seek?.serial ?? null
  const seenSerial = useRef(seekSerial)
  useEffect(() => {
    if (seekSerial === seenSerial.current) return
    seenSerial.current = seekSerial
    const seek = port.current?.seek
    if (seek !== null && seek !== undefined) control.current.seekTo(seek.sec)
  }, [seekSerial])

  const seekTo = useCallback((sec: number): void => {
    control.current.seekTo(sec)
    port.current?.onSeek?.(sec)
  }, [])
  /** 1 歩は見えている位置から（他が鳴っている間、再生器の位置は古いまま）。 */
  const nudge = useCallback(
    (deltaSec: number): void => {
      seekTo(resolveSeekTarget(shown.current, deltaSec, control.current.durationSec))
    },
    [seekTo],
  )
  return useMemo(
    () => ({ ...playback, currentSec: shownSec, seekTo, nudge }),
    [playback, shownSec, seekTo, nudge],
  )
}
