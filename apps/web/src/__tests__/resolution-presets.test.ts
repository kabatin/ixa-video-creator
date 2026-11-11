import { AspectRatio, PROJECT_RESOLUTIONS } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { ASPECT_RATIOS, defaultResolutionKeyFor, resolutionPresetsFor } from '@/lib/resolution-presets'

describe('resolutionPresetsFor', () => {
  it('選べる大きさは domain の表そのまま（画面だけの大きさを持たない）', () => {
    for (const aspectRatio of AspectRatio.options) {
      expect(resolutionPresetsFor(aspectRatio).map((preset) => preset.resolution)).toEqual(
        PROJECT_RESOLUTIONS[aspectRatio],
      )
    }
  })

  it('どの大きさにも名前がある（domain に足して名前を忘れると、数字だけの選択肢になる）', () => {
    for (const aspectRatio of ASPECT_RATIOS) {
      for (const preset of resolutionPresetsFor(aspectRatio)) {
        expect(preset.name, preset.key).not.toMatch(/^\d+×\d+$/)
        expect(preset.label).toBe(
          `${preset.name} (${String(preset.resolution.width)}×${String(preset.resolution.height)})`,
        )
      }
    }
  })

  it('既定は各形の先頭', () => {
    expect(defaultResolutionKeyFor('16:9')).toBe('1920x1080')
    expect(defaultResolutionKeyFor('9:16')).toBe('1080x1920')
  })
})
