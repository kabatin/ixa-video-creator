'use client'

import { useEffect, type RefObject } from 'react'
import { usePlayheadSec } from '@/lib/playhead-sec'
import { followScrollLeft, playheadLeftPx } from '@/lib/timeline-playhead'

/** 再生位置を追うかと、そのための材料（制作者 2026-10-02「他画面に合わせチェックで追従ON/OFF」）。 */
export type TimelineFollow = {
  /** 「再生位置を追う」が入っているか。 */
  readonly enabled: boolean
  /** 再生位置が動いているか（どのパネルが鳴らしていても）。動いている間は真ん中に保つ。 */
  readonly moving: boolean
  /** 自分で横に送った。追うのをやめる（送った先から引き戻さない。聴きながら切ると同じ）。 */
  readonly onUserScroll: () => void
}

/** 左の見出しの列の幅（11rem。`timeline-tracks.tsx` の `w-44`）。文字の大きさの設定に付いていく。 */
const LABEL_REM = 11
const labelPx = (): number => {
  const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return LABEL_REM * (Number.isFinite(rootPx) && rootPx > 0 ? rootPx : 16)
}

/**
 * タイムラインの横スクロールを再生位置へ付いていかせる（制作者 2026-10-02「タイムラインも現在位置に合わせて追従するようにしたい」）。
 * 何も描かない。**位置を毎コマ読むのはこの部品だけ**（帯の全体を描き直さない。`@/lib/playhead-sec`）。
 * どこまで送るかは `followScrollLeft`（聴きながら切ると同じ決まり）。
 */
export const TimelineFollowPlayhead = ({
  boxRef,
  follow,
  durationSec,
  pxPerSec,
}: {
  readonly boxRef: RefObject<HTMLDivElement | null>
  readonly follow: TimelineFollow
  readonly durationSec: number
  readonly pxPerSec: number
}) => {
  const sec = usePlayheadSec()
  const { enabled, moving, onUserScroll } = follow

  useEffect(() => {
    const box = boxRef.current
    if (!enabled || box === null) return
    const label = labelPx()
    const next = followScrollLeft({
      playheadPx: playheadLeftPx(sec, durationSec, pxPerSec),
      scrollLeft: box.scrollLeft,
      viewportPx: box.clientWidth,
      labelPx: label,
      contentPx: Math.max(box.scrollWidth - label, 0),
      playing: moving,
    })
    if (next !== null) box.scrollLeft = next
  }, [boxRef, enabled, moving, sec, durationSec, pxPerSec])

  // 自分で横に送ったら追うのをやめる。横のホイール（Shift＋ホイール・トラックパッド）と、スクロールバーを掴んだとき。
  useEffect(() => {
    const box = boxRef.current
    if (!enabled || box === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) onUserScroll()
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target === box) onUserScroll()
    }
    box.addEventListener('wheel', onWheel, { passive: true })
    box.addEventListener('pointerdown', onPointerDown)
    return () => {
      box.removeEventListener('wheel', onWheel)
      box.removeEventListener('pointerdown', onPointerDown)
    }
  }, [boxRef, enabled, onUserScroll])

  return null
}
