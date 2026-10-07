import { describe, expect, it } from 'vitest'
import { lacksCameraMovement, lacksStoryboard } from '../generation/take-readiness.js'

/**
 * 説明も最初のフレームも無い Shot（制作者 2026-10-01「全然関係ない動画が生成されてしまう」）。
 * 1 件の生成と一括生成が同じ判定を使う。
 */
describe('lacksStoryboard', () => {
  it('説明も最初のフレームも無ければ true', () => {
    expect(lacksStoryboard({ description: '', hasStartFrame: false })).toBe(true)
    expect(lacksStoryboard({ description: '  \n ', hasStartFrame: false })).toBe(true)
  })

  it('どちらかがあれば false', () => {
    expect(lacksStoryboard({ description: '夕焼けの屋上で振り返る', hasStartFrame: false })).toBe(false)
    expect(lacksStoryboard({ description: '', hasStartFrame: true })).toBe(false)
  })
})

/**
 * カメラの動きが決まっていない Shot（ADR-0042）。
 * 指定が無いと、動く Shot で被写体が画面から外れることがある（実測）。
 */
describe('lacksCameraMovement', () => {
  const withMovement = (movement: string | null) => ({ camera: { movement } })

  it('決まっていなければ true', () => {
    expect(lacksCameraMovement(withMovement(null))).toBe(true)
  })

  it.each(['static', 'pan', 'tilt', 'push_in', 'pull_out', 'tracking', 'handheld', 'crane', 'orbit'])(
    '%s が選ばれていれば false（フィックスも「決めた」に数える）',
    (movement) => {
      expect(lacksCameraMovement(withMovement(movement))).toBe(false)
    },
  )
})
