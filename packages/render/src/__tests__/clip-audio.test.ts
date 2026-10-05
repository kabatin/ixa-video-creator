import { describe, expect, it } from 'vitest'
import { clipAudioVolume } from '../clip-audio.js'

/** 効果音の音量（ADR-0039）。フェードが無ければ決まった値、あればクリップの頭からのコマで変わる。 */

describe('clipAudioVolume', () => {
  it('フェードが無ければ、音量そのもの（コマごとに計算しない）', () => {
    expect(clipAudioVolume({ volume: 0.8, durationSec: 2 }, 30)).toBe(0.8)
    expect(clipAudioVolume({ volume: 0.8, durationSec: 2, fadeInSec: 0, fadeOutSec: 0 }, 30)).toBe(0.8)
  })

  it('フェードがあれば、頭から上げて終わりへ下げる（クリップの頭からのコマ）', () => {
    const volume = clipAudioVolume({ volume: 1, durationSec: 2, fadeInSec: 0.5, fadeOutSec: 1 }, 30)
    if (typeof volume === 'number') throw new Error('コマごとの音量になっていません')
    expect(volume(0)).toBe(0)
    expect(volume(7.5)).toBeCloseTo(0.5, 5)
    expect(volume(30)).toBeCloseTo(1, 5)
    expect(volume(45)).toBeCloseTo(0.5, 5)
    expect(volume(60)).toBe(0)
  })
})
