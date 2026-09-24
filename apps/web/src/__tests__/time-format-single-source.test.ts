import { describe, expect, it } from 'vitest'
import * as formatTime from '@/lib/format-time'
import * as timelineDisplay from '@/lib/timeline-display'

/**
 * 時間の書式は `lib/format-time.ts` の 1 箇所が正。
 *
 * かつて `lib/timeline-display.ts` が `formatClock` と `formatDuration` を独自に持ち、
 * **名前が同じで規則が正反対**だった。
 * - `format-time`: 「尺は秒（`3.75s`）。時計形式だと長さに見えない」
 * - `timeline-display`: 「尺は時計形式と生の秒を併記する（`0:03.75（3.75s）`）」
 *
 * どちらを import したかで同じ値が別物に見え、画面ごとに表記が割れていた。
 * 書き写した規則は必ずズレる。同じ関数を通しているかをここで押さえる。
 */
describe('時間の書式は 1 箇所が正', () => {
  const samples = [0, 0.004, 3.75, 59.999, 60, 116.04, 3599.995]

  it('timeline-display の formatClock は format-time と同じ関数', () => {
    expect(timelineDisplay.formatClock).toBe(formatTime.formatClock)
  })

  it('timeline-display は独自の formatDuration を持たない', () => {
    // 併記が要る場所は `formatLongDuration` という別の名前で呼ぶ。
    expect('formatDuration' in timelineDisplay).toBe(false)
    expect(timelineDisplay.formatLongDuration).toBe(formatTime.formatLongDuration)
  })

  it('尺は秒、位置は時計形式（規則そのもの）', () => {
    expect(formatTime.formatDuration(3.75)).toBe('3.75s')
    expect(formatTime.formatClock(3.75)).toBe('0:03.75')
  })

  it('長い尺だけ時計形式を併記する', () => {
    expect(formatTime.formatLongDuration(116.04)).toBe('1:56.04（116.04s）')
  })

  it('秒の繰り上がりで 0:60.00 を作らない', () => {
    // 秒の側だけを toFixed すると 59.999 が `0:60.00` になる。
    expect(formatTime.formatClock(59.999)).toBe('1:00.00')
    samples.forEach((sec) => {
      expect(formatTime.formatClock(sec)).not.toMatch(/:60\./)
    })
  })

  it('負と NaN は 0 に倒す（壊れた計算を画面に出さない）', () => {
    expect(formatTime.formatClock(-3.5)).toBe('0:00.00')
    expect(formatTime.formatClock(Number.NaN)).toBe('0:00.00')
  })
})
