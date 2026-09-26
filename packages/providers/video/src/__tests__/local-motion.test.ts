import { describe, expect, it } from 'vitest'
import { buildMotionFilter, planStillMotion } from '../local/motion.js'

/**
 * 1 枚の画像をどう動かすか（ADR-0025）。**Shot のカメラ指定に従う。**
 * 指定が無ければ seed で選ぶ。同じ画像から作り直しても毎回違う Take になり、
 * checksum の重複判定で古い Take に化けない。
 */

const camera = (movement: string | null, movementIntensity: string | null = null) =>
  ({ size: null, angleH: null, angle: null, lensMm: null, movement, movementIntensity }) as never

describe('planStillMotion', () => {
  it('寄り・引きの指定はそのまま使う', () => {
    expect(planStillMotion(camera('push_in'), 1).kind).toBe('push_in')
    expect(planStillMotion(camera('pull_out'), 1).kind).toBe('pull_out')
  })

  it('パンは左右、ティルトは上下のどちらか', () => {
    expect(['pan_left', 'pan_right']).toContain(planStillMotion(camera('pan'), 7).kind)
    expect(['tilt_up', 'tilt_down']).toContain(planStillMotion(camera('tilt'), 7).kind)
  })

  it('強さの指定で動く量が増える', () => {
    const subtle = planStillMotion(camera('push_in', 'subtle'), 1).amount
    const strong = planStillMotion(camera('push_in', 'strong'), 1).amount
    expect(strong).toBeGreaterThan(subtle)
  })

  it('固定でもわずかに寄る（止め絵のままにしない）', () => {
    const plan = planStillMotion(camera('static'), 1)
    expect(plan.kind).toBe('push_in')
    expect(plan.amount).toBeGreaterThan(0)
    expect(plan.amount).toBeLessThan(0.05)
  })

  it('指定が無ければ seed で選び、seed が違えば結果も違いうる', () => {
    const plans = new Set(Array.from({ length: 8 }, (_, seed) => JSON.stringify(planStillMotion(camera(null), seed))))
    expect(plans.size).toBeGreaterThan(1)
  })

  /**
   * カメラ指定があっても seed で量をわずかに揺らす。以前は指定があると動きが完全に決まり、
   * 2 本頼んでも同じ動画になって重複として 1 本にまとめられた（撮影用の作例で実測）。
   */
  it('カメラ指定があっても、seed が違えば動く量が違う（同じ動画にならない）', () => {
    const a = planStillMotion(camera('push_in', 'moderate'), 1)
    const b = planStillMotion(camera('push_in', 'moderate'), 2)
    expect(a.kind).toBe(b.kind)
    expect(a.amount).not.toBe(b.amount)
  })

  it('揺らしても、強さの順は崩れない', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      expect(planStillMotion(camera('push_in', 'strong'), seed).amount).toBeGreaterThan(
        planStillMotion(camera('push_in', 'moderate'), seed + 7).amount,
      )
    }
  })

  it('同じ seed なら同じ動き（再現できる）', () => {
    expect(planStillMotion(camera(null), 42)).toEqual(planStillMotion(camera(null), 42))
  })
})

describe('buildMotionFilter', () => {
  it('出力の大きさ・コマ数・fps を zoompan に渡す', () => {
    const filter = buildMotionFilter({ kind: 'push_in', amount: 0.1 }, { width: 1280, height: 720, fps: 24, frames: 96 })

    expect(filter).toContain('zoompan=')
    expect(filter).toContain('s=1280x720')
    expect(filter).toContain('d=96')
    expect(filter).toContain('fps=24')
  })

  it('縦長の出力でも、切り抜いて画面を埋める（黒帯を出さない）', () => {
    const filter = buildMotionFilter({ kind: 'pan_left', amount: 0.1 }, { width: 1080, height: 1920, fps: 30, frames: 30 })

    expect(filter).toContain('force_original_aspect_ratio=increase')
    expect(filter).toContain('crop=')
  })
})
