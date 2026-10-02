import { ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { rangeBetween, sortShots, statusCounts } from '@/lib/shot-list-view'
import { aWorkbenchShot } from './workbench-fixture'

const a = aWorkbenchShot(1, { durationSec: 3, status: 'approved' })
const b = aWorkbenchShot(2, { durationSec: 1, status: 'draft' })
const c = aWorkbenchShot(3, { durationSec: 2, status: 'review' })

describe('sortShots', () => {
  it('番号順', () => {
    expect(sortShots([c, a, b], 'start', 'asc').map((s) => s.code)).toEqual(['CUT-01', 'CUT-02', 'CUT-03'])
  })

  /**
   * 番号（#）は**動画の並び**（制作者 2026-10-02「分割したり削除、新規作成などを繰り返していると順番がおかしくなる。
   * 開始位置を基にソートされてくれると嬉しい」）。後から作った・分けた Shot は order が後ろに付く。
   */
  it('番号順は開始位置の順。同じ位置なら作った順（order）', () => {
    const inserted = aWorkbenchShot(9, { code: 'CUT-09', startSec: 2, order: 9000 })
    const sameStart = aWorkbenchShot(8, { code: 'CUT-08', startSec: 2, order: 8000 })

    expect(sortShots([c, inserted, a, sameStart, b], 'start', 'asc').map((s) => s.code)).toEqual([
      'CUT-08',
      'CUT-09',
      'CUT-01',
      'CUT-02',
      'CUT-03',
    ])
  })

  it('尺の長い順', () => {
    expect(sortShots([a, b, c], 'duration', 'desc').map((s) => s.code)).toEqual(['CUT-01', 'CUT-03', 'CUT-02'])
  })

  it('状態は制作の流れの順（下書き → 承認）', () => {
    expect(sortShots([a, b, c], 'status', 'asc').map((s) => s.status)).toEqual(['draft', 'review', 'approved'])
  })

  it('入力を変えない', () => {
    const input = [c, a, b]
    sortShots(input, 'start', 'asc')
    expect(input.map((s) => s.code)).toEqual(['CUT-03', 'CUT-01', 'CUT-02'])
  })
})

describe('statusCounts', () => {
  it('ある状態だけを流れの順で数える', () => {
    expect(statusCounts([a, b, c, c])).toEqual([
      ['draft', 1],
      ['review', 2],
      ['approved', 1],
    ])
  })
})

describe('rangeBetween', () => {
  const ids = [a.id, b.id, c.id]

  it('起点から押した行まで（逆向きも）', () => {
    expect(rangeBetween(ids, a.id, c.id)).toEqual(ids)
    expect(rangeBetween(ids, c.id, b.id)).toEqual([b.id, c.id])
  })

  it('起点が無い・見えていなければ押した行だけ', () => {
    expect(rangeBetween(ids, null, b.id)).toEqual([b.id])
    expect(rangeBetween(ids, ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FZZ'), b.id)).toEqual([b.id])
  })
})
