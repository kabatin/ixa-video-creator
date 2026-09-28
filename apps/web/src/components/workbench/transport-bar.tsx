'use client'

import { useTransport, useWorkbench } from '@/components/workbench/workbench-context'
import { formatClock } from '@/lib/format-time'
import { TRANSPORT_OWNER_LABELS } from '@/lib/transport-labels'
import { TransportButtons } from '@/components/workbench/transport-buttons'

/**
 * プレビューの下の操作列（前の境目へ・1 コマ戻る・再生・1 コマ進む・次の境目へ）。
 *
 * 経緯:
 * 1. はじめはパネルごとに見た目の同じ再生ボタンがあり、縦に 2 つ並んでどちらが何を鳴らすのか
 *    区別が無かった → 画面にひとつだけにした
 * 2. **映像の道具で再生ボタンが画面の最下段にあるのは探す場所として素直ではない**（制作者の指摘）
 *    → プレイヤーの直下を定位置にした
 * 3. ボタン 1 つでは寂しい。一般的な動画編集ツールの並びにし、「聴きながら切る」にも置く
 *    （2026-09-28、制作者の提案）。**それぞれのプレイヤーの直下に置くので、どれが鳴るかは場所で分かる**
 *
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
  const { transportControls } = useWorkbench()
  const transport = useTransport()
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
      <TransportButtons owner={owner} durationSec={durationSec} />
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
