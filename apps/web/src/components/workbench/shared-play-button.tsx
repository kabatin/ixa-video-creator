'use client'

import { PauseIcon, PlayIcon } from '@/components/workbench/transport-icons'
import { useTransportState, useWorkbench, type TransportOwner } from '@/components/workbench/workbench-context'

/**
 * 再生ボタン。**プレビューの下でも波形の上でも同じ部品を使う**（操作列 `TransportButtons` の真ん中）。
 *
 * 以前は置き場所で別の部品だった（プレビューは黄色の ▶、波形は文字の「再生」）。
 * 見た目が違うだけでなく、波形側は**自分の音**しか見ていなかったので、
 * Take 比較が鳴っている最中も「再生」と出ていた。いま何かが鳴っているかは
 * 共有の再生状態で決める。
 *
 * - 何かが鳴っていれば ⏸（押すと止まる。鳴っているのが別のパネルでも）
 * - 止まっていれば ▶（押すと**置かれた場所が**鳴る。押したものと鳴るものを食い違わせない）
 */
export const SharedPlayButton = ({ owner }: { readonly owner: TransportOwner }) => {
  const { transportControls } = useWorkbench()
  const transport = useTransportState()
  const playing = transport.playing && transport.owner !== null

  return (
    <button
      type="button"
      aria-pressed={playing}
      aria-label={playing ? '一時停止' : '再生'}
      onClick={() => {
        if (playing) transportControls.pause()
        else transportControls.play(owner)
      }}
      className="inline-flex h-7 min-w-10 shrink-0 items-center justify-center rounded bg-accent text-base text-accent-fg hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  )
}
