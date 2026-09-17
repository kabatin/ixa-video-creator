'use client'

import type { TransitionInsertionPoint } from '@/lib/timeline-insert'
import { transitionInsertionLeftPx } from '@/lib/timeline-insert'
import { formatDuration, transitionTypeLabel } from '@/lib/timeline-display'

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
   * 押された。`leftPx` は帯の左端からの位置。`clientY` は画面上の縦位置で、
   * **入力を出す縦の場所を親が計算するために要る**（帯は縦に積まれていて、
   * どの行かはこの部品からは分からない）。
   */
  readonly onOpen: (point: TransitionInsertionPoint, leftPx: number, clientY: number) => void
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
        className="m-1 flex items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-500"
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
              onOpen(point, leftPx, rect.bottom)
            }}
            className={
              existing === null
                ? // まだ何も無い境目。**見た目だけ隠す。** 焦点が当たれば現れる。
                  `absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center ` +
                  `rounded-full border border-dashed border-slate-400 bg-white text-slate-600 ` +
                  `opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 ` +
                  `group-hover/row:opacity-60 disabled:cursor-not-allowed ` +
                  `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ` +
                  (open ? 'opacity-100 ring-2 ring-slate-900' : '')
                : `absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-0.5 ` +
                  `text-[10px] ring-1 hover:bg-violet-200 disabled:cursor-not-allowed ` +
                  `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ` +
                  (open
                    ? 'bg-violet-200 text-violet-900 ring-violet-600'
                    : 'bg-violet-100 text-violet-900 ring-violet-300')
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
              `${transitionTypeLabel(existing.type)} ${formatDuration(existing.durationSec)}`
            )}
          </button>
        )
      })}
    </div>
  )
}
