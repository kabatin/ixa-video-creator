import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_VOLUME,
  MAX_VOLUME,
  MIN_VOLUME,
  clampVolume,
  describeVolume,
} from '@/lib/playback-state'
import {
  DEFAULT_VOLUME_PREFERENCE,
  readVolumePreference,
  writeVolumePreference,
} from '@/lib/volume-preference'

/**
 * 音量。**要素が例外を投げる範囲へ入れないこと**と、
 * **消音と音量 0 を混ぜないこと**を固定する。
 */

describe('音量を丸める', () => {
  it('範囲の中はそのまま', () => {
    expect(clampVolume(0.42)).toBe(0.42)
  })

  it('両端は通る', () => {
    expect(clampVolume(MIN_VOLUME)).toBe(0)
    expect(clampVolume(MAX_VOLUME)).toBe(1)
  })

  /** `HTMLMediaElement.volume` は範囲外で例外を投げる。ここで止める。 */
  it('範囲外は端に寄せる', () => {
    expect(clampVolume(-1)).toBe(0)
    expect(clampVolume(2)).toBe(1)
    expect(clampVolume(100)).toBe(1)
  })

  it('数値でなければ既定へ倒す', () => {
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME)
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VOLUME)
  })

  /** 0 は正しい音量。`||` で潰すと、下げきった瞬間に最大へ跳ね上がる。 */
  it('0 を既定へ倒さない', () => {
    expect(clampVolume(0)).toBe(0)
  })
})

describe('音量の言い方', () => {
  it('百分率で言う', () => {
    expect(describeVolume(0.5, false)).toBe('音量 50%')
  })

  /**
   * どちらも音は出ないが戻し方が違う。消音は解除すれば元の大きさに戻り、
   * 音量 0 は上げ直す必要がある。同じ文にすると直し方が分からない。
   */
  it('消音と音量 0 を別の文にする', () => {
    const muted = describeVolume(0.8, true)
    const zero = describeVolume(0, false)

    expect(muted).not.toBe(zero)
    expect(muted).toContain('解除')
    expect(zero).toContain('消音ではありません')
  })

  it('消音中でも解除後の大きさを伝える', () => {
    expect(describeVolume(0.3, true)).toContain('30%')
  })
})

describe('音量の覚え書き', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('書いたものを読み戻せる', () => {
    writeVolumePreference({ volume: 0.25, muted: true })

    expect(readVolumePreference()).toEqual({ volume: 0.25, muted: true })
  })

  it('何も無ければ既定', () => {
    expect(readVolumePreference()).toEqual(DEFAULT_VOLUME_PREFERENCE)
  })

  it('壊れた値は既定へ倒す', () => {
    store.set('ixa.playback.volume', 'とても大きく')

    expect(readVolumePreference().volume).toBe(DEFAULT_VOLUME)
  })

  it('範囲外で保存されていても丸める', () => {
    store.set('ixa.playback.volume', '9')

    expect(readVolumePreference().volume).toBe(MAX_VOLUME)
  })

  it('音量 0 は覚えたまま読み戻す', () => {
    writeVolumePreference({ volume: 0, muted: false })

    expect(readVolumePreference().volume).toBe(0)
  })

  /**
   * プライベートウィンドウや保存を止めている設定では、触るだけで例外が出る。
   * **覚えられないだけで、再生は続けられなければならない。**
   */
  it('読めなくても落ちない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('保存は使えません')
      },
      setItem: () => {
        throw new Error('保存は使えません')
      },
    })

    expect(readVolumePreference()).toEqual(DEFAULT_VOLUME_PREFERENCE)
  })

  it('書けなくても落ちない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('保存は使えません')
      },
    })

    expect(() => {
      writeVolumePreference({ volume: 0.5, muted: false })
    }).not.toThrow()
  })
})
