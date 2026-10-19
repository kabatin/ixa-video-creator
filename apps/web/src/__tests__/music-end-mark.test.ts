import { describe, expect, it } from 'vitest'
import { musicEndMark, musicEndOverlayPct } from '@/lib/music-end-mark'

/**
 * 曲の終わりの赤線（制作者 2026-10-19「曲の終わりが赤線で見えればよい」）。
 * 波形は音源の時間で描くので、線の位置は「開始位置から数えた終わり」。題はタイムラインの時刻で言う。
 */

describe('musicEndMark', () => {
  it('曲の終わりが無ければ線を引かない', () => {
    expect(musicEndMark({ offsetSec: 0, endSec: null }, 30)).toBeNull()
    expect(musicEndMark({ offsetSec: 0 }, 30)).toBeNull()
  })

  it('音源の途中で切っていれば、その位置に線を引き、題はタイムラインの時刻', () => {
    expect(musicEndMark({ offsetSec: 0, endSec: 26.38 }, 30)).toEqual({
      atSec: 26.38,
      title: '曲の終わり 0:26.38',
    })
  })

  it('開始位置をずらしていれば、波形の上の位置は開始位置から数える', () => {
    const mark = musicEndMark({ offsetSec: 2, endSec: 26 }, 30)
    expect(mark?.atSec).toBe(24)
    expect(mark?.title).toBe('曲の終わり 0:26.00')
  })

  it('音源の尺以上なら自然に終わるので線を引かない', () => {
    expect(musicEndMark({ offsetSec: 0, endSec: 30 }, 30)).toBeNull()
    expect(musicEndMark({ offsetSec: 0, endSec: 40 }, 30)).toBeNull()
  })
})

describe('musicEndOverlayPct', () => {
  it('表示範囲の中なら左からの割合（%）', () => {
    expect(musicEndOverlayPct(25, { startSec: 0, endSec: 100 })).toBe(25)
    expect(musicEndOverlayPct(15, { startSec: 10, endSec: 30 })).toBe(25)
  })

  it('表示範囲より前なら 0（全部が終わりの後）、後ろなら null（映っていない）', () => {
    expect(musicEndOverlayPct(5, { startSec: 10, endSec: 30 })).toBe(0)
    expect(musicEndOverlayPct(31, { startSec: 10, endSec: 30 })).toBeNull()
  })

  it('幅 0 の表示範囲では描かない', () => {
    expect(musicEndOverlayPct(10, { startSec: 10, endSec: 10 })).toBeNull()
  })
})
