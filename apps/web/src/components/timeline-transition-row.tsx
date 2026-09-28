'use client'

import type { TransitionInsertionPoint } from '@/lib/timeline-insert'
import { transitionInsertionLeftPx } from '@/lib/timeline-insert'
import { formatLongDuration, transitionTypeLabel } from '@/lib/timeline-display'

/**
 * Shot と Shot の境目に、その場で挿すための帯。
 *
 * 以前は帯の下に一覧があり、そこで「どの境目か」を選んでから足していた。
 * **境目は帯の上に既に見えているので、そこを直接押せればよい。**
 * 一覧は不要になった。
 *
 * **押せる場所は常に DOM に置く。** マウスを乗せたときだけ作ると、
 * キーボードでは永久に辿り着けない。見た目だけを `opacity` で隠し、
 * `hover` と `focus-visible` の両方で現す。`display: none` にはしない。
 */

const HANDLE_SIZE_PX = 18

export type TimelineTransitionRowProps = {
  readonly points: readonly TransitionInsertionPoint[]
  readonly pxPerSec: number
  readonly heightPx: number
  readonly busy: boolean
  /** いま開いている境目。開いている印を付けるために使う。 */
  readonly openAtSec: number | null
  /**
   * 押された。`clientX` / `clientY` は入力を出す場所（画面の座標。入力は画面全体に出す）。
   */
  /** `opener` は押されたボタン。**閉じたあと焦点を戻す先**として要る。 */
  readonly onOpen: (
    point: TransitionInsertionPoint,
    clientX: number,
    clientY: number,
    opener: HTMLElement,
  ) => void
}

export const TimelineTransitionRow = ({
  points,
  pxPerSec,
  heightPx,
  busy,
  openAtSec,
  onOpen,
}: TimelineTransitionRowProps) => {
  if (points.length === 0) {
    return (
      <div
        className="m-1 flex items-center justify-center rounded border border-dashed border-line-strong text-xs text-muted"
        style={{ height: heightPx - 8 }}
      >
        Shot が 2 個以上ないと境目がありません
      </div>
    )
  }

  return (
    <div className="group/row relative" style={{ height: heightPx }}>
      {points.map((point) => {
        const leftPx = transitionInsertionLeftPx(point, pxPerSec)
        const existing = point.existing
        const open = openAtSec !== null && Math.abs(openAtSec - point.atSec) < 1e-6

        return (
          <button
            key={`${point.pair.from.id}-${point.pair.to.id}`}
            type="button"
            disabled={busy}
            aria-expanded={open}
            title={point.message}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onOpen(point, rect.left + rect.width / 2, rect.bottom, event.currentTarget)
            }}
            className={
              existing === null
                ? // まだ何も無い境目。**見た目だけ隠す。** 焦点が当たれば現れる。
                  `absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center ` +
                  `rounded-full border border-dashed border-line-strong bg-surface text-muted ` +
                  `opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 ` +
                  `group-hover/row:opacity-60 disabled:cursor-not-allowed ` +
                  `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ` +
                  (open ? 'opacity-100 ring-2 ring-accent' : '')
                : `absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-0.5 ` +
                  `text-xs ring-1 hover:bg-accent-soft/30 disabled:cursor-not-allowed ` +
                  `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ` +
                  (open
                    ? 'bg-accent-soft/30 text-text ring-accent'
                    : 'bg-accent-soft/15 text-text ring-accent/40')
            }
            style={
              existing === null
                ? { left: leftPx, width: HANDLE_SIZE_PX, height: HANDLE_SIZE_PX }
                : { left: leftPx }
            }
          >
            {existing === null ? (
              <>
                <span aria-hidden="true" className="text-sm leading-none">
                  +
                </span>
                <span className="sr-only">
                  {`${point.pair.from.code} と ${point.pair.to.code} の間にトランジションを挿す`}
                </span>
              </>
            ) : (
              `${transitionTypeLabel(existing.type)} ${formatLongDuration(existing.durationSec)}`
            )}
          </button>
        )
      })}
    </div>
  )
}
