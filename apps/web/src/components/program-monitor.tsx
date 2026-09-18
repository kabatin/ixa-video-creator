'use client'

import type { TimelineDocument } from '@ixa/domain'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { describeMonitorState, monitorAspectRatio, type SeekCommand } from '@/lib/program-monitor'

/**
 * プログラムモニター（P60-2）。
 *
 * 再生するのは `packages/render` の `TimelineComposition` **そのもの**で、
 * `<video>` を継ぎ接ぎしたものではない。プレビューと書き出しが同じ
 * `TimelineDocument` と同じコンポジションを入力にすることで、
 * 「プレビューでは合っていたのに書き出すとズレる」を構造的に防ぐ（ADR-0010）。
 *
 * 再生位置は**外が持つ**。帯（タイムライン）と再生ヘッドを同じ 1 つの値に
 * 従わせるため、この部品は位置を自分では覚えず、進んだら `onFrame` で返すだけにする。
 */

const MonitorMessage = ({
  role,
  tone,
  message,
}: {
  readonly role: 'status' | 'alert'
  readonly tone: 'muted' | 'danger'
  readonly message: string
}) => (
  <p
    role={role}
    className={`flex h-full items-center justify-center p-6 text-center text-sm ${
      tone === 'danger' ? 'text-danger' : 'text-muted'
    }`}
  >
    {message}
  </p>
)

/**
 * `@remotion/player` は `window` を前提にしている。
 * サーバでは描画せず、ブラウザに届いてから読み込む（L-019）。
 */
const ProgramMonitorPlayer = dynamic(
  () => import('@/components/program-monitor-player').then((mod) => mod.ProgramMonitorPlayer),
  {
    ssr: false,
    loading: () => (
      <MonitorMessage role="status" tone="muted" message="モニターを準備しています。" />
    ),
  },
)

export type ProgramMonitorProps = {
  /** **null は「まだ読めていない」。** Shot が 0 件のタイムラインとは別物（L-015 / L-021）。 */
  readonly document: TimelineDocument | null
  /** 取り付け時の再生位置。帯の再生ヘッドと同じ値を渡す。その後の追従は `onFrame` の報告で行う。 */
  readonly currentSec: number
  /** 利用者が目盛りなどで明示的に指定した位置。`serial` が変わったときだけ Player が飛ぶ。 */
  readonly seek: SeekCommand | null
  readonly playing: boolean
  /** 再生する区間の先頭（秒）。省略すると先頭から。 */
  readonly inSec?: number
  /** 再生する区間の終わり（秒）。**この秒自体は再生しない。** 省略すると終端まで。 */
  readonly outSec?: number
  /** 区間の終わりまで来たら先頭へ戻る。既定は戻らない。 */
  readonly loop?: boolean
  /**
   * 再生中に進んだ位置を返す。
   *
   * **2 つ並べるときは片方だけが返すこと。** 両方が返すと位置が双方向に流れ、
   * 6.0 で潰した往復が戻る（lessons L-023）。
   */
  readonly onFrame: (sec: number) => void
  readonly onPlayingChange: (playing: boolean) => void
  readonly onError?: (message: string) => void
}

export const ProgramMonitor = ({
  document,
  currentSec,
  seek,
  playing,
  inSec,
  outSec,
  loop,
  onFrame,
  onPlayingChange,
  onError,
}: ProgramMonitorProps) => {
  const [failure, setFailure] = useState<string | null>(null)
  /** 素材 1 本の失敗。絵は出したまま、下に理由を添える。 */
  const [mediaFailure, setMediaFailure] = useState<string | null>(null)

  // タイムラインを読み直したら、前の失敗は持ち越さない。
  // 署名付き URL の期限切れは引き直せば直るので、古い赤字を残すと直ったことが伝わらない。
  useEffect(() => {
    setFailure(null)
    setMediaFailure(null)
  }, [document])

  /** 再生そのものが壊れた。絵は信用できないので出さない。 */
  const handleFatalError = useCallback(
    (message: string) => {
      setFailure(message)
      onPlayingChange(false)
      onError?.(message)
    },
    [onError, onPlayingChange],
  )

  /**
   * Shot 1 本の素材を読めなかった。
   * **絵は消さない。** 1 本欠けただけでモニター全体を落とすと、
   * 他の Shot が映っているかどうかまで分からなくなる。理由だけを添える（L-015）。
   */
  const handleMediaError = useCallback(
    (message: string) => {
      setMediaFailure(message)
      onError?.(message)
    },
    [onError],
  )

  const state = describeMonitorState(document, playing, failure)

  return (
    <section aria-label="プログラムモニター" className="flex flex-col gap-2">
      <div
        className="w-full overflow-hidden rounded-lg border border-line bg-bg"
        style={{ aspectRatio: String(monitorAspectRatio(document)) }}
      >
        {state.canRender && document !== null ? (
          <ProgramMonitorPlayer
            document={document}
            initialSec={currentSec}
            seek={seek}
            playing={playing}
            inSec={inSec}
            outSec={outSec}
            loop={loop}
            onFrame={onFrame}
            onPlayingChange={onPlayingChange}
            onFatalError={handleFatalError}
            onMediaError={handleMediaError}
          />
        ) : (
          <MonitorMessage
            role={state.status === 'error' ? 'alert' : 'status'}
            tone={state.status === 'error' ? 'danger' : 'muted'}
            message={state.message}
          />
        )}
      </div>

      {state.canRender && <p className="text-xs text-muted">{state.message}</p>}

      {mediaFailure !== null && (
        <p role="alert" className="text-xs text-danger">
          {mediaFailure}
        </p>
      )}
    </section>
  )
}
