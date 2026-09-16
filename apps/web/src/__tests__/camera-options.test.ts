import { AngleHorizontal, AngleVertical, CameraMovement, ShotSize } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  ANGLE_HORIZONTAL_OPTIONS,
  ANGLE_VERTICAL_OPTIONS,
  CAMERA_MOVEMENT_OPTIONS,
  MOVEMENT_INTENSITY_OPTIONS,
  NONE_VALUE,
  SHOT_SIZE_OPTIONS,
} from '@/lib/camera-options'
import { MODEL_OPTIONS, TAKE_COUNT_OPTIONS } from '@/lib/generation-options'

const valuesOf = (options: readonly { value: string }[]): string[] =>
  options.map((option) => option.value)

describe('カメラの選択肢', () => {
  it('景別は domain の enum と完全に一致する', () => {
    expect(valuesOf(SHOT_SIZE_OPTIONS)).toEqual([...ShotSize.options])
  })

  it('nullable な列には未指定が先頭に入る', () => {
    expect(valuesOf(ANGLE_HORIZONTAL_OPTIONS)).toEqual([NONE_VALUE, ...AngleHorizontal.options])
    expect(valuesOf(ANGLE_VERTICAL_OPTIONS)).toEqual([NONE_VALUE, ...AngleVertical.options])
    expect(valuesOf(CAMERA_MOVEMENT_OPTIONS)).toEqual([NONE_VALUE, ...CameraMovement.options])
  })

  it('動きの強度は 3 段階 + 未指定', () => {
    expect(valuesOf(MOVEMENT_INTENSITY_OPTIONS)).toEqual([
      NONE_VALUE,
      'subtle',
      'moderate',
      'strong',
    ])
  })

  it('すべての選択肢にラベルがある', () => {
    for (const option of [...SHOT_SIZE_OPTIONS, ...CAMERA_MOVEMENT_OPTIONS]) {
      expect(option.label).not.toBe('')
    }
  })
})

describe('生成の選択肢', () => {
  it('Phase 1 のモデルは AUTO のみ', () => {
    expect(valuesOf(MODEL_OPTIONS)).toEqual(['AUTO'])
  })

  it('本数は 1〜4', () => {
    expect(valuesOf(TAKE_COUNT_OPTIONS)).toEqual(['1', '2', '3', '4'])
  })
})
