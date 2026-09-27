'use client'

import type { TimelineDocument } from '@ixa/domain'
import { TimelineComposition, type TimelineCompositionProps } from '@ixa/render/composition'
import { Player, type PlayerRef } from '@remotion/player'
import { useEffect, useMemo, useRef } from 'react'
import { usePlaybackVolume } from '@/lib/use-playback-volume'
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
  /**
   * 自分が鳴らしていないときに、絵だけ合わせにいく位置（秒）。
   * ほかのパネルが鳴らしている間、時計だけ進んで絵が止まるのを防ぐ。
   * `null` / 省略なら追従しない。
   */
  readonly followSec?: number | null
  /** 再生する区間の先頭（秒）。省略すると先頭から。 */
  readonly inSec?: number
  /** 再生する区間の終わり（秒）。**この秒自体は再生しない。** 省略すると終端まで。 */
  readonly outSec?: number
  /** 区間の終わりまで来たら先頭へ戻る。既定は戻らない。 */
  readonly loop?: boolean
  readonly onFrame: (sec: number) => void
  readonly onPlayingChange: (playing: boolean) => void
  /** 再生そのものが壊れた。絵は出せない。 */
  readonly onFatalError: (message: string) => void
  /** Shot 1 本の素材を読めなかった。残りの絵は出せる。 */
  readonly onMediaError: (message: string) => void
}

/**
 * 再生する区間の秒を Player のフレーム番号へ。
 *
 * **`outFrame` は「最後に再生するフレーム」で、その番号自体を再生する**
 * （`@remotion/player` の `use-playback` が `actualLastFrame` として使う）。
 * 区間の終わりの秒をそのまま渡すと、繰り返すたびに**次の Shot の頭が 1 フレーム映る**。
 * 秒は区間の境目を指すので、フレームに直したら 1 引く。
 *
 * 尺の外のフレームは Player が扱えないので、両端を尺の中へ丸める。
 * 丸めた結果 終わりが先頭より前に来たら、先頭の 1 フレームだけを区間にする。
 */
const spanFrames = (
  inSec: number | undefined,
  outSec: number | undefined,
  fps: number,
  durationInFrames: number,
): { readonly inFrame: number | null; readonly outFrame: number | null } => {
  const lastFrame = Math.max(0, durationInFrames - 1)
  const clamp = (frame: number): number => Math.min(Math.max(frame, 0), lastFrame)

  const inFrame = inSec === undefined ? null : clamp(secToFrame(inSec, fps))
  if (outSec === undefined) return { inFrame, outFrame: null }

  const outFrame = Math.max(clamp(secToFrame(outSec, fps) - 1), inFrame ?? 0)
  return { inFrame, outFrame }
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
  followSec = null,
  inSec,
  outSec,
  loop = false,
  onFrame,
  onPlayingChange,
  onFatalError,
  onMediaError,
}: ProgramMonitorPlayerProps) => {
  const playerRef = useRef<PlayerRef | null>(null)

  /**
   * 音量は画面でひとつ（`usePlaybackVolume`）。**Player の既定に任せない。**
   *
   * 以前ここは音量を一度も見ておらず、「聴きながら切る」で 15% にしていても
   * プレビューは 100% で鳴っていた（実測）。曲を聴きながら切る道具で、
   * 別のパネルを押した瞬間に最大音量が出るのは事故に近い。
   */
  const { volume, muted } = usePlaybackVolume()

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
  const { inFrame, outFrame } = spanFrames(inSec, outSec, fps, durationInFrames)

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
    let active = true

    /**
     * **位置の報告は Player の effect の外で渡す。**
     *
     * `@remotion/player` は `frameupdate` を自分の `useEffect` から配る。ここで親の state を
     * 同期的に更新すると、React は毎フレーム「effect の flush 中の更新」と数える。位置を見て
     * effect で動く部品（聴きながら切るの追従など）と繋がり、読み込み待ちで途切れが無くなると、
     * 開発時に `Maximum update depth exceeded` が積もった（2026-09-27、モトダチ MV の再生で実測）。
     * マイクロタスクへ出せば flush の外になり、位置は同じ順番で、ほぼ遅れずに届く。
     */
    const handleFrame = ({ detail }: { detail: { frame: number } }) => {
      const sec = frameToSec(detail.frame, fps)
      queueMicrotask(() => {
        if (active) handlersRef.current.onFrame(sec)
      })
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
      active = false
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

  // 取り付け直後にも当てる。`initiallyMuted` だけだと音量そのものが 100% のまま残る。
  useEffect(() => {
    const player = playerRef.current
    if (player === null) return
    player.setVolume(volume)
    if (muted) player.mute()
    else player.unmute()
  }, [volume, muted])

  /**
   * 共有の位置に**絵だけ**追従する。
   *
   * 自分が鳴らしていないとき（「聴きながら切る」が鳴っているとき）、以前のここは
   * 明示的な `seek` しか見ていなかったので、時計だけ進んで**絵は止まったまま**だった。
   * 画面には「停止中」と出るのに曲は流れている、という食い違いになる。
   *
   * 鳴らしている最中は当てない。自分の報告が返ってきたものと区別できず、
   * 位置が双方向に流れる（L-023）。同じコマなら飛ばさない（毎フレームの seek は重い）。
   */
  useEffect(() => {
    const player = playerRef.current
    if (player === null || playing || followSec === null || followSec === undefined) return
    const frame = secToFrame(followSec, fps)
    if (player.getCurrentFrame() === frame) return
    seekingRef.current = true
    try {
      player.seekTo(frame)
    } finally {
      seekingRef.current = false
    }
  }, [followSec, playing, fps])

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
      inFrame={inFrame}
      outFrame={outFrame}
      loop={loop}
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
