import { RenderPreset } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { letterboxFit, PRESET_SETTINGS, presetResolution } from '../presets.js'

/** docs/ARCHITECTURE.md §16 の表。ここが唯一の正であり、実装をこれに合わせる。 */
const EXPECTED = {
  preview_720p: { width: 1280, height: 720, crf: 26 },
  master_1080p: { width: 1920, height: 1080, crf: 18 },
  master_4k: { width: 3840, height: 2160, crf: 18 },
  social_vertical: { width: 1080, height: 1920, crf: 20 },
} as const

describe('PRESET_SETTINGS', () => {
  it('RenderPreset の全値が定義されている', () => {
    expect(Object.keys(PRESET_SETTINGS).sort()).toEqual([...RenderPreset.options].sort())
  })

  it.each(RenderPreset.options)('%s の解像度と CRF が表のとおり', (preset) => {
    const settings = PRESET_SETTINGS[preset]
    expect(settings.width).toBe(EXPECTED[preset].width)
    expect(settings.height).toBe(EXPECTED[preset].height)
    expect(settings.crf).toBe(EXPECTED[preset].crf)
  })

  it.each(RenderPreset.options)('%s は yuv420p で出力する', (preset) => {
    expect(PRESET_SETTINGS[preset].pixelFormat).toBe('yuv420p')
  })

  it.each(RenderPreset.options)('%s の audioBitrate は ffmpeg が解釈できる形式', (preset) => {
    expect(PRESET_SETTINGS[preset].audioBitrate).toMatch(/^\d+k$/)
  })

  it('presetResolution はプリセットの解像度を返す', () => {
    expect(presetResolution('master_4k')).toEqual({ width: 3840, height: 2160 })
  })
})

describe('letterboxFit', () => {
  it('同じアスペクト比ならキャンバス全体を使う', () => {
    expect(letterboxFit({ width: 1920, height: 1080 }, PRESET_SETTINGS.preview_720p)).toEqual({
      width: 1280,
      height: 720,
      left: 0,
      top: 0,
    })
  })

  it('16:9 を縦キャンバスに入れると上下に黒帯が付く（切り落とさない）', () => {
    const fit = letterboxFit({ width: 1920, height: 1080 }, PRESET_SETTINGS.social_vertical)
    expect(fit.width).toBe(1080)
    expect(fit.height).toBe(608)
    expect(fit.left).toBe(0)
    expect(fit.top).toBe(656)
  })

  it('縦素材を横キャンバスに入れると左右に黒帯が付く', () => {
    const fit = letterboxFit({ width: 1080, height: 1920 }, PRESET_SETTINGS.master_1080p)
    expect(fit.height).toBe(1080)
    expect(fit.width).toBe(608)
    expect(fit.top).toBe(0)
    expect(fit.left).toBe(656)
  })

  it('幅と高さは必ず偶数（yuv420p が奇数サイズを許さない）', () => {
    const fit = letterboxFit({ width: 1001, height: 563 }, PRESET_SETTINGS.master_1080p)
    expect(fit.width % 2).toBe(0)
    expect(fit.height % 2).toBe(0)
  })

  it('拡大もアスペクト比を保つ', () => {
    const fit = letterboxFit({ width: 640, height: 360 }, PRESET_SETTINGS.master_1080p)
    expect(fit).toEqual({ width: 1920, height: 1080, left: 0, top: 0 })
  })
})
