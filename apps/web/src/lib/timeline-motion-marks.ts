import { formatClock } from '@/lib/format-time'
import type { WireShotMotion } from '@/lib/motion-api'

/**
 * タイムラインの効果音の段の上に薄く出す、動きの分析の出来事の印（ADR-0054）。**純粋。**
 * 手で効果音を置くときの目安。押すとそこから再生する。
 */

export type MotionMark = {
  /** タイムラインの秒。 */
  readonly atSec: number
  readonly label: string
  readonly title: string
}

/** Shot ごとの分析を、時刻順の 1 列の印にする。同じ時刻の印は先に出た方だけを残す。 */
export const motionMarksOf = (motions: readonly WireShotMotion[]): readonly MotionMark[] =>
  motions
    .flatMap((motion) => motion.events)
    .map((event) => ({
      atSec: event.startSec,
      label: event.label,
      title: `${formatClock(event.startSec)} ${event.label}（押すとここから再生）`,
    }))
    .sort((a, b) => a.atSec - b.atSec)
    .filter((mark, i, all) => i === 0 || all[i - 1]?.atSec !== mark.atSec)
