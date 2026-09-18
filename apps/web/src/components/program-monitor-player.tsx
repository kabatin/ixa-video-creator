'use client'

import type { TimelineDocument } from '@ixa/domain'
import { TimelineComposition, type TimelineCompositionProps } from '@ixa/render/composition'
import { Player, type PlayerRef } from '@remotion/player'
import { useEffect, useMemo, useRef } from 'react'
import {
  frameToSec,
  monitorDurationInFrames,
  monitorErrorMessage,
  monitorMediaErrorMessage,
  secToFrame,
  type SeekCommand,
} from '@/lib/program-monitor'

/**
 * `@remotion/player` を抱える内側の部品。
 *
 * **別ファイルに切ってある理由。** `@remotion/player` は `window` を前提にしており、
 * サーバの描画に混ぜられない。親（`program-monitor.tsx`）が `next/dynamic` の
 * `ssr: false` でここだけを遅れて読み込む。同じファイルに置くと、
 * import しただけでサーバ側のバンドルに載る（L-019）。
 *
 * 描くのは `packages/render` の `TimelineComposition` **そのもの**。
 * 画面用に別のコンポジションを作らないことが、
 * 「プレビューでは合っていたのに書き出すとズレる」を防ぐ唯一の方法（ADR-0010）。
 *
 * **位置の流れは一方通行。** 進んだ位置は `onFrame` で親へ返すだけで、
 * 親の位置を見てシークすることはしない。シークするのは `seek`（利用者の明示的な指示）
 * が変わったときだけ。親の位置を見て飛ぶと、自分の報告が返ってきたものと
 * 外からの指示を推測で分ける必要があり、その推測は必ず破れる（`program-monitor.ts` 参照）。
 */
export type ProgramMonitorPlayerProps = {
  readonly document: TimelineDocument
  /** 取り付け時の位置。**その後の追従には使わない**（進んだ位置は `onFrame` で返す）。 */
  readonly initialSec: number
  /** 利用者の明示的なシーク。`serial` が変わったときだけ飛ぶ。 */
  readonly seek: SeekCommand | null
  readonly playing: boolean
  readonly onFrame: (sec: number) => void
  readonly onPlayingChange: (playing: boolean) => void
  /** 再生そのものが壊れた。絵は出せない。 */
  readonly onFatalError: (message: string) => void
  /** Shot 1 本の素材を読めなかった。残りの絵は出せる。 */
  readonly onMediaError: (message: string) => void
}

/** `<video>` / `<img>` / `<audio>` の読み込み失敗だけを拾う。 */
const isMediaElement = (target: EventTarget | null): boolean =>
  target instanceof HTMLVideoElement ||
  target instanceof HTMLImageElement ||
  target instanceof HTMLAudioElement

export const ProgramMonitorPlayer = ({
  document,
  initialSec,
  seek,
  playing,
  onFrame,
  onPlayingChange,
  onFatalError,
  onMediaError,
}: ProgramMonitorPlayerProps) => {
  const playerRef = useRef<PlayerRef | null>(null)

  /**
   * **自分のシークが起こした `pause` を外へ出さないための印。**
   *
   * `@remotion/player` の `seekTo` は、再生中だと内部で `pause()` してから
   * シークし、直後に自分で再開する（`hasPausedToResume`）。
   * この一瞬の `pause` を親へ渡すと、親の `playing` が false になり、
   * こちらの `[playing]` effect が再開直後の Player を本当に止めてしまう。
   * `seekTo` は同期的に `pause` を配るので、呼び出しの前後で囲えば漏れない。
   * 末尾へ飛んだときだけ Player は再開せず `ended` を配るので、そちらで止まりを伝える。
   */
  const seekingRef = useRef(false)

  /** 同じ素材の失敗を何度も親へ流さない。`<video>` は繰り返し error を出す。 */
  const mediaErrorReportedRef = useRef(false)

  // 購読はマウント時の 1 回だけにしたいが、呼ぶ相手は毎描画で変わりうる。
  // 最新の関数を ref 越しに呼ぶことで、購読の付け外しを繰り返さない。
  const handlersRef = useRef({ onFrame, onPlayingChange, onFatalError, onMediaError })
  handlersRef.current = { onFrame, onPlayingChange, onFatalError, onMediaError }

  // 取り付け時の位置。毎描画で変わる値を Player の `initialFrame` に渡さないよう、最初の値だけ持つ。
  const initialFrameRef = useRef(secToFrame(initialSec, document.fps))

  const { fps } = document
  const durationInFrames = monitorDurationInFrames(document)

  const inputProps = useMemo<TimelineCompositionProps>(
    () => ({ doc: document, canvas: null }),
    [document],
  )

  // タイムラインを読み直したら、素材の失敗は報告し直せるようにする。
  useEffect(() => {
    mediaErrorReportedRef.current = false
  }, [document])

  useEffect(() => {
    const player = playerRef.current
    if (player === null) return

    const handleFrame = ({ detail }: { detail: { frame: number } }) => {
      handlersRef.current.onFrame(frameToSec(detail.frame, fps))
    }
    const handlePlay = () => handlersRef.current.onPlayingChange(true)
    const handlePause = () => {
      if (seekingRef.current) return
      handlersRef.current.onPlayingChange(false)
    }
    const handleEnded = () => handlersRef.current.onPlayingChange(false)
    // 例外の本文には署名付き URL が入りうる。**中身を外へ渡さない**（program-monitor.ts 参照）。
    const handleError = () => handlersRef.current.onFatalError(monitorErrorMessage())

    player.addEventListener('frameupdate', handleFrame)
    player.addEventListener('play', handlePlay)
    player.addEventListener('pause', handlePause)
    player.addEventListener('ended', handleEnded)
    player.addEventListener('error', handleError)

    return () => {
      player.removeEventListener('frameupdate', handleFrame)
      player.removeEventListener('play', handlePlay)
      player.removeEventListener('pause', handlePause)
      player.removeEventListener('ended', handleEnded)
      player.removeEventListener('error', handleError)
    }
  }, [fps])

  /**
   * 素材の読み込み失敗を拾う。
   *
   * `<video>` / `<img>` の `error` は**バブリングしない**ので、
   * Player の入れ物で **capture** して拾う。Player の `error` イベントは
   * コンポジションが投げた例外しか流れてこないため、404 はここでしか分からない。
   * **URL は文に含めない**（署名付き URL を親へ渡さない）。
   */
  useEffect(() => {
    const container = playerRef.current?.getContainerNode() ?? null
    if (container === null) return

    const handleMediaError = (event: Event) => {
      if (!isMediaElement(event.target)) return
      if (mediaErrorReportedRef.current) return
      mediaErrorReportedRef.current = true
      handlersRef.current.onMediaError(monitorMediaErrorMessage())
    }

    container.addEventListener('error', handleMediaError, true)
    return () => {
      container.removeEventListener('error', handleMediaError, true)
    }
  }, [])

  // 利用者の指示があったときだけ飛ぶ。同じ指示（同じ serial）では飛び直さない。
  useEffect(() => {
    const player = playerRef.current
    if (player === null || seek === null) return

    seekingRef.current = true
    try {
      player.seekTo(secToFrame(seek.sec, fps))
    } finally {
      seekingRef.current = false
    }
  }, [seek, fps])

  useEffect(() => {
    const player = playerRef.current
    if (player === null) return
    if (playing && !player.isPlaying()) player.play()
    if (!playing && player.isPlaying()) player.pause()
  }, [playing])

  return (
    <Player
      ref={playerRef}
      component={TimelineComposition}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      fps={fps}
      compositionWidth={document.resolution.width}
      compositionHeight={document.resolution.height}
      initialFrame={initialFrameRef.current}
      style={{ width: '100%', height: '100%' }}
      // 個人利用のため会社規模によるライセンス契約は不要（制作者に確認、2026-09-18）。
      // 商用として販売する段になったら remotion.dev/license を見直すこと。
      acknowledgeRemotionLicense
      clickToPlay={false}
      // 再生・停止の割り当ては画面側で 1 か所にまとめる（cut-editor-keys と同じ方針）。
      // Player が独自に Space を奪うと、割り当てが 2 箇所に分かれる。
      spaceKeyToPlayOrPause={false}
    />
  )
}
