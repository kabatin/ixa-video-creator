import { describe, expect, it } from 'vitest'
import { ShotId } from '../common/ids.js'
import { findOverlappingShots, orderBetween, shotEndSec } from '../shot/shot.js'
import { MANUAL_PRIORITY, referencePriority } from '../shot/reference.js'
import { cameraToPromptFragment } from '../shot/camera.js'

const id = (n: number) => ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${n.toString().padStart(2, '0')}`)

describe('shot timing', () => {
  it('終了時刻は開始 + 編集尺', () => {
    expect(shotEndSec({ startSec: 51.2, durationSec: 4.6 })).toBeCloseTo(55.8)
  })

  it('重なっている Shot を検出する', () => {
    const shots = [
      { id: id(1), startSec: 0, durationSec: 5 },
      { id: id(2), startSec: 4, durationSec: 5 },
      { id: id(3), startSec: 10, durationSec: 5 },
    ]
    expect(findOverlappingShots(shots)).toEqual([[id(1), id(2)]])
  })

  it('隣接（境界が一致）は重なりではない', () => {
    const shots = [
      { id: id(1), startSec: 0, durationSec: 5 },
      { id: id(2), startSec: 5, durationSec: 5 },
    ]
    expect(findOverlappingShots(shots)).toEqual([])
  })
})

describe('orderBetween', () => {
  it('間に挿入するときは中間値を返す', () => {
    expect(orderBetween(1000, 2000)).toBe(1500)
  })
  it('先頭・末尾・空のケースを扱える', () => {
    expect(orderBetween(null, 1000)).toBe(0)
    expect(orderBetween(1000, null)).toBe(2000)
    expect(orderBetween(null, null)).toBe(1000)
  })
})

describe('referencePriority', () => {
  it('手動追加は常に最優先', () => {
    expect(referencePriority({ role: 'style', sourceKind: 'manual' })).toBe(MANUAL_PRIORITY)
  })
  it('人物の同一性は衣装より優先される', () => {
    const subject = referencePriority({ role: 'subject', sourceKind: 'derived_character' })
    const wardrobe = referencePriority({ role: 'wardrobe', sourceKind: 'derived_look' })
    expect(subject).toBeLessThan(wardrobe)
  })
})

describe('cameraToPromptFragment', () => {
  it('カメラ指定を人が読める断片へ落とす', () => {
    const fragment = cameraToPromptFragment({
      size: 'medium_closeup', angleH: 'front_left', angle: 'low',
      lensMm: 50, movement: 'push_in', movementIntensity: 'subtle',
    })
    expect(fragment).toBe('medium closeup, from front left, low angle, 50mm lens, subtle push in')
  })

  it('static は動きとして出力しない', () => {
    const fragment = cameraToPromptFragment({
      size: 'wide', angleH: null, angle: null, lensMm: null,
      movement: 'static', movementIntensity: null,
    })
    expect(fragment).toBe('wide')
  })
})
