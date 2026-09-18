'use client'

import type { MouseEvent } from 'react'
import {
  beatTicks,
  clampToSpan,
  compareNoticeClassName,
  describeBeatState,
  secAtSpanFraction,
  spanEndSec,
  spanPercent,
  type CompareSpan,
  type WireCompareBeatState,
} from '@/lib/take-compare'
import { formatClock } from '@/lib/timeline-display'

/**
 * 拍の目盛り（P61-2）。
 *
 * **この Shot の区間に入る拍だけ**を縦線で出し、再生ヘッドを重ねる。
 * 曲全体の拍を出すと、判断したい 4 秒が 116 秒の中に埋もれて何も読めない。
 *
 * 計算は `@/lib/take-compare` の純粋関数に閉じてある。この部品がするのは
 * 「押された場所を割合にする」「返ってきた値を並べる」だけ。
 */

export type BeatRulerProps = {
  /** 曲全体の拍（絶対秒）。区間で切るのはこの部品の中で行う。 */
  readonly beats: readonly number[]
  /**
   * 小節頭（絶対秒）。**渡さなければ従来どおり**、すべて同じ太さで出る。
   * ミュージックビデオのカットは小節頭に置くのが基本なので、そこだけ太くする。
   */
  readonly downbeats?: readonly number[]
  /** 拍の出どころの状態。**「解析が無い」と「拍が 0 件」を混ぜない**（L-015）。 */
  readonly beatState: WireCompareBeatState
  readonly span: CompareSpan
  /** 再生ヘッドの位置（絶対秒）。 */
  readonly currentSec: number
  /** 目盛りを押したときに行きたい位置（絶対秒）。 */
  readonly onSeek: (sec: number) => void
}

export const BeatRuler = ({
  beats,
  downbeats = [],
  beatState,
  span,
  currentSec,
  onSeek,
}: BeatRulerProps) => {
  const ticks = beatTicks(beats, span, downbeats)
  const notice = describeBeatState(beatState, ticks.length)
  const headSec = clampToSpan(currentSec, span)
  const headPercent = spanPercent(headSec, span)

  /**
   * 押された場所を区間内の秒へ。
   * **幅が取れないときは動かさない。** 0 で割ると先頭へ飛び、
   * 「押した場所へ行かない」ではなく「勝手に戻る」という別の不具合に見える。
   */
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    onSeek(secAtSpanFraction((event.clientX - rect.left) / rect.width, span))
  }

  return (
    <section aria-label="拍の目盛り" className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        aria-label={`拍の目盛り。押した位置へ移動します（${formatClock(span.startSec)} から ${formatClock(spanEndSec(span))}）`}
        className="relative block h-10 w-full overflow-hidden rounded border border-line bg-surface-2 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {ticks.map((tick) => (
          <span
            key={tick.sec}
            aria-hidden
            /**
             * 小節頭 > 区間の先頭 > 普通の拍、の順に強く出す。
             * **小節頭は上下いっぱいまで伸ばす**ので、太さだけでなく長さでも分かる。
             */
            className={`absolute ${
              tick.isDownbeat
                ? 'inset-y-0 w-1 bg-text'
                : tick.isFirst
                  ? 'inset-y-1 w-0.5 bg-line-strong'
                  : 'inset-y-1 w-px bg-line-strong'
            }`}
            style={{ left: `${String(tick.percent)}%` }}
          />
        ))}

        <span
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-accent"
          style={{ left: `${String(headPercent)}%` }}
        />
      </button>

      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>{formatClock(span.startSec)}</span>
        <span aria-live="polite">
          {formatClock(headSec)}
          <span className="text-faint"> / </span>拍 {ticks.length} 件
        </span>
        <span>{formatClock(spanEndSec(span))}</span>
      </div>

      {notice !== null && (
        <p className={`text-xs ${compareNoticeClassName(notice.tone)}`}>
          {notice.headline}。{notice.detail}
        </p>
      )}
    </section>
  )
}
