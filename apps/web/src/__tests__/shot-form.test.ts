import { describe, expect, it } from 'vitest'
import { NONE_VALUE } from '@/lib/camera-options'
import { initialShotFormValues, validateShotForm, type ShotFormValues } from '@/lib/shot-form'

const ORDER = 2000

const valid = (overrides: Partial<ShotFormValues> = {}): ShotFormValues => ({
  ...initialShotFormValues(),
  code: 'S01-010',
  ...overrides,
})

const run = (overrides: Partial<ShotFormValues> = {}) =>
  validateShotForm({ values: valid(overrides), order: ORDER })

describe('validateShotForm', () => {
  it('正しい入力を CreateShotInput へ変換する', () => {
    const result = run({ code: '  S01-010  ', startSec: '1.5', durationSec: '4.25' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.code).toBe('S01-010')
    expect(result.input.startSec).toBe(1.5)
    expect(result.input.durationSec).toBe(4.25)
    expect(result.input.order).toBe(ORDER)
    expect(result.input.sequenceId).toBeNull()
    expect(result.input.dialogue).toBeNull()
    expect(result.input.sourceType).toEqual({ type: 'ai_video' })
  })

  it('未指定のカメラ列は null になる', () => {
    const result = run()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.camera).toEqual({
      size: 'medium',
      angleH: null,
      angle: null,
      lensMm: null,
      movement: null,
      movementIntensity: null,
    })
  })

  it('カメラの選択値をそのまま載せる', () => {
    const result = run({
      angleH: 'front_left',
      angle: 'low',
      lensMm: '35',
      movement: 'push_in',
      movementIntensity: 'strong',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.camera).toMatchObject({
      angleH: 'front_left',
      angle: 'low',
      lensMm: 35,
      movement: 'push_in',
      movementIntensity: 'strong',
    })
  })

  it('コードが空ならコードのエラーになる', () => {
    const result = run({ code: '   ' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.code).toBeDefined()
    expect(result.errors.durationSec).toBeUndefined()
  })

  it.each(['0', '-1', '', 'abc'])('尺 %s は尺のエラーになる', (durationSec) => {
    const result = validateShotForm({ values: valid({ durationSec }), order: ORDER })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.durationSec).toBeDefined()
  })

  it.each(['-1', '', 'abc'])('開始秒 %s は開始秒のエラーになる', (startSec) => {
    const result = validateShotForm({ values: valid({ startSec }), order: ORDER })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.startSec).toBeDefined()
  })

  it('開始秒 0 は許す', () => {
    expect(run({ startSec: '0' }).ok).toBe(true)
  })

  it.each(['0', '-35', 'abc'])('レンズ %s はレンズのエラーになる', (lensMm) => {
    const result = validateShotForm({ values: valid({ lensMm }), order: ORDER })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.lensMm).toBeDefined()
  })

  it('未知の景別は景別のエラーになる', () => {
    const result = run({ size: 'telephoto' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.size).toBeDefined()
  })

  it('mood が空なら null にする', () => {
    const result = run({ mood: '   ' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.mood).toBeNull()
  })

  it('初期値は未指定のカメラ列を NONE_VALUE で持つ', () => {
    const values = initialShotFormValues(12)

    expect(values.startSec).toBe('12')
    expect(values.angleH).toBe(NONE_VALUE)
    expect(values.movement).toBe(NONE_VALUE)
  })
})
