import { ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { rangeBetween, sortShots, statusCounts } from '@/lib/shot-list-view'
import { aWorkbenchShot } from './workbench-fixture'

const a = aWorkbenchShot(1, { durationSec: 3, status: 'approved' })
const b = aWorkbenchShot(2, { durationSec: 1, status: 'draft' })
const c = aWorkbenchShot(3, { durationSec: 2, status: 'review' })

describe('sortShots', () => {
  it('番号順', () => {
    expect(sortShots([c, a, b], 'order', 'asc').map((s) => s.code)).toEqual(['CUT-01', 'CUT-02', 'CUT-03'])
  })

  it('尺の長い順', () => {
    expect(sortShots([a, b, c], 'duration', 'desc').map((s) => s.code)).toEqual(['CUT-01', 'CUT-03', 'CUT-02'])
  })

  it('状態は制作の流れの順（下書き → 承認）', () => {
    expect(sortShots([a, b, c], 'status', 'asc').map((s) => s.status)).toEqual(['draft', 'review', 'approved'])
  })

  it('入力を変えない', () => {
    const input = [c, a, b]
    sortShots(input, 'order', 'asc')
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
