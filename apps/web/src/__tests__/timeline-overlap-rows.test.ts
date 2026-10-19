import { describe, expect, it } from 'vitest'
import { assignOverlapRows, overlapRowAtOffset } from '@/lib/timeline-overlap-rows'

/**
 * 同じ Layer の中で時間が重なるクリップを別の行にずらす（制作者 2026-10-19）。
 * 重なると文字が読めず、動かしたり尺を変えたりすると別のクリップが動いた。
 */
const clip = (id: string, startSec: number, durationSec: number) => ({ id, startSec, durationSec })

describe('assignOverlapRows', () => {
  it('重ならなければ全部 1 行目（接しているだけは重なりではない）', () => {
    const { rows, rowCount } = assignOverlapRows([clip('a', 0, 2), clip('b', 2, 1), clip('c', 5, 1)])
    expect(rowCount).toBe(1)
    expect([...rows.values()]).toEqual([0, 0, 0])
  })

  it('重なるものは次の行へ。空いた行があれば上の行を使い直す', () => {
    const { rows, rowCount } = assignOverlapRows([
      clip('a', 0, 4),
      clip('b', 1, 2),
      clip('c', 2, 3),
      clip('d', 4.5, 1),
    ])
    expect(rowCount).toBe(3)
    expect(Object.fromEntries(rows)).toEqual({ a: 0, b: 1, c: 2, d: 0 })
  })

  it('並び順に左右されない（始まりの早い順に決める。同じなら ID 順）', () => {
    const forward = assignOverlapRows([clip('a', 0, 3), clip('b', 0, 3), clip('c', 1, 1)])
    const backward = assignOverlapRows([clip('c', 1, 1), clip('b', 0, 3), clip('a', 0, 3)])
    expect(Object.fromEntries(backward.rows)).toEqual(Object.fromEntries(forward.rows))
    expect(Object.fromEntries(forward.rows)).toEqual({ a: 0, b: 1, c: 2 })
  })

  it('空なら 1 行（置く場所は残す）', () => {
    expect(assignOverlapRows([]).rowCount).toBe(1)
  })
})

describe('overlapRowAtOffset', () => {
  const layout = { topPx: 12, rowPitchPx: 24, rowCount: 3 }

  it('上からの位置で行を決める', () => {
    expect(overlapRowAtOffset(12, layout)).toBe(0)
    expect(overlapRowAtOffset(35, layout)).toBe(0)
    expect(overlapRowAtOffset(36, layout)).toBe(1)
    expect(overlapRowAtOffset(60, layout)).toBe(2)
  })

  it('札の上は 1 行目、下にはみ出したら最後の行', () => {
    expect(overlapRowAtOffset(0, layout)).toBe(0)
    expect(overlapRowAtOffset(500, layout)).toBe(2)
  })
})
