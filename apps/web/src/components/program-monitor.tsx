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
  /**
   * 自分が鳴らしていないときに、絵だけ合わせにいく位置（秒）。
   *
   * 別のパネル（聴きながら切る）が鳴らしている間、共有の時計は進むのに
   * ここの絵は止まったままだった。曲は流れているのに画面は真っ黒で「停止中」と出る、
   * という食い違いになる。鳴らす役は渡さず、**絵だけ**合わせる。
   */
  readonly followSec?: number | null
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
  /**
   * 絵の合わせ方。
   *
   * - `width`（既定）— 幅いっぱいに広げ、高さは比から決まる。
   *   横に 2 枚並べる Take 比較のように、**高さが決まっていない入れ物**ではこちら。
   * - `contain` — 入れ物の幅と高さの**両方**に収める。縦に潰れたパネルでも絵が全部見える。
   *   高さの決まった入れ物（ドックのパネル）でのみ使う。
   */
  readonly fit?: 'width' | 'contain'
}

export const ProgramMonitor = ({
  document,
  currentSec,
  seek,
  playing,
  followSec = null,
  inSec,
  outSec,
  loop,
  onFrame,
  onPlayingChange,
  onError,
  fit = 'width',
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
  const ratio = monitorAspectRatio(document)

  /**
   * 絵の枠。`contain` では**幅を高さからも決める**。
   *
   * `aspectRatio` だけでは幅から高さが決まるため、パネルを縦に縮めると絵が下へはみ出し、
   * スクロールしないと全部見えなくなる。入れ物を大きさのコンテナにして
   * `min(幅いっぱい, 高さいっぱい × 比)` を取れば、幅と高さのどちらが先に尽きても収まる。
   */
  const frame = (
    <div
      className={`overflow-hidden rounded-lg border border-line bg-bg ${
        fit === 'contain' ? '' : 'w-full'
      }`}
      style={
        fit === 'contain'
          ? {
              aspectRatio: String(ratio),
              width: `min(100cqw, calc(100cqh * ${String(ratio)}))`,
            }
          : { aspectRatio: String(ratio) }
      }
    >
      {state.canRender && document !== null ? (
        <ProgramMonitorPlayer
          document={document}
          initialSec={currentSec}
          seek={seek}
          playing={playing}
          followSec={followSec}
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
  )

  return (
    <section
      aria-label="プログラムモニター"
      className={`flex flex-col gap-2 ${fit === 'contain' ? 'h-full min-h-0' : ''}`}
    >
      {fit === 'contain' ? (
        <div
          className="grid min-h-0 flex-1 place-items-center"
          style={{ containerType: 'size' }}
        >
          {frame}
        </div>
      ) : (
        frame
      )}

      {state.canRender && state.message !== '' && (
        <p className="shrink-0 text-xs text-muted">{state.message}</p>
      )}

      {mediaFailure !== null && (
        <p role="alert" className="shrink-0 text-xs text-danger">
          {mediaFailure}
        </p>
      )}
    </section>
  )
}
