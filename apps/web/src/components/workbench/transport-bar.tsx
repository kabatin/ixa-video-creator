'use client'

import { useWorkbench } from '@/components/workbench/workbench-context'
import { formatClock } from '@/lib/format-time'
import { TRANSPORT_OWNER_LABELS } from '@/lib/transport-labels'

/**
 * 再生の操作。**画面にひとつだけ、見えているプレイヤーの直下に置く。**
 *
 * 以前はパネルごとに再生ボタンがあり、プレビューと「聴きながら切る」を同時に開くと
 * 同じ見た目のボタンが縦に 2 つ並んだ。どちらが何を鳴らすのか区別が無い。
 * 一度ステータスバーへまとめたが、**映像の道具で再生ボタンが画面の最下段にあるのは
 * 探す場所として素直ではない**（制作者の指摘）。プレイヤーの下が定位置。
 *
 * 出す場所は `transportControls.host` が決める（絵が出るほうを先に選ぶ）。
 * **出した場所が鳴らす相手でもある。** 押したものと鳴るものが食い違わないように。
 * 音量は作業中に何度も触るものではないのでステータスバーに置いたまま。
 */
export type TransportBarProps = {
  /** このパネルが出す資格を持つか。`host` と一致するときだけ出す。 */
  readonly owner: 'cutter' | 'monitor'
  /** 尺。分かっていれば「位置 / 尺」で出す。 */
  readonly durationSec?: number | null
}

export const TransportBar = ({ owner, durationSec = null }: TransportBarProps) => {
  const { transport, transportControls } = useWorkbench()
  if (transportControls.host !== owner) return null

  const playing = transport.playing && transport.owner !== null
  const elsewhere =
    playing && transport.owner !== null && transport.owner !== owner
      ? TRANSPORT_OWNER_LABELS[transport.owner]
      : null

  /**
   * **ボタンは絵の真下の中央。** 左端に寄せると、絵の中心を見ている目から遠い。
   * 3 列にして中の列だけを中央に置く（左右に何を置いてもボタンの位置は動かない）。
   */
  return (
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-line bg-surface px-2 py-1">
      {/* 鳴らしているのが別のパネルなら言う。無言だと壊れていると読まれる。 */}
      <span className="justify-self-start text-xs text-accent">
        {elsewhere === null ? '' : `${elsewhere} が再生中`}
      </span>
      <button
        type="button"
        aria-pressed={playing}
        aria-label={playing ? '一時停止' : '再生'}
        onClick={() => {
          transportControls.togglePlayback(owner)
        }}
        className="inline-flex h-7 min-w-10 items-center justify-center rounded bg-accent text-base text-accent-fg hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {playing ? '⏸' : '▶'}
      </button>
      <span className="justify-self-end font-mono text-sm tabular-nums text-text">
        {formatClock(transport.currentSec)}
        {durationSec !== null && (
          <>
            <span className="text-faint"> / </span>
            {formatClock(durationSec)}
          </>
        )}
      </span>
    </div>
  )
}
