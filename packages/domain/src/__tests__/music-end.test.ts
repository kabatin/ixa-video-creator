import { describe, expect, it } from 'vitest'
import { fadeGainAt } from '../audio/mix.js'
import { MusicTrack, UpdateMusicTrackPatch } from '../music/music.js'
import { MUSIC_TRIM_FADE_OUT_SEC, musicPlayedDurationSec, trimMusicPatch } from '../music/music-end.js'

describe('musicPlayedDurationSec（曲の終わり）', () => {
  it('曲の終わりが無ければ音源の尺のまま（ミュージックビデオの既定）', () => {
    expect(musicPlayedDurationSec({ offsetSec: 0, endSec: null }, 32)).toBe(32)
    expect(musicPlayedDurationSec({ offsetSec: 2 }, 32)).toBe(32)
  })

  it('曲の終わりはタイムライン上の秒。開始位置から数えた長さで止まる', () => {
    expect(musicPlayedDurationSec({ offsetSec: 0, endSec: 26.38 }, 32)).toBeCloseTo(26.38)
    expect(musicPlayedDurationSec({ offsetSec: 2, endSec: 26.38 }, 32)).toBeCloseTo(24.38)
  })

  it('音源より後ろを指しても、音源の尺より長くは鳴らさない', () => {
    expect(musicPlayedDurationSec({ offsetSec: 0, endSec: 40 }, 32)).toBe(32)
  })

  it('開始位置より前を指したら鳴らさない（負の尺にしない）', () => {
    expect(musicPlayedDurationSec({ offsetSec: 10, endSec: 5 }, 32)).toBe(0)
  })
})

describe('曲の終わりに向けたフェードアウト', () => {
  it('切った終わりに向けて下がり、終わりで 0 になる', () => {
    const shape = { startSec: 0, durationSec: musicPlayedDurationSec({ offsetSec: 0, endSec: 26 }, 32), fadeInSec: 0, fadeOutSec: 0.5 }
    expect(fadeGainAt(25, shape)).toBe(1)
    expect(fadeGainAt(25.75, shape)).toBeCloseTo(0.5)
    expect(fadeGainAt(26, shape)).toBe(0)
    expect(fadeGainAt(27, shape)).toBe(0)
  })
})

describe('trimMusicPatch（曲を最後の Shot で切る）', () => {
  it('曲の終わりを入れ、フェードアウトが 0 なら 0.5 秒にする（プツッと切れないように）', () => {
    expect(trimMusicPatch({ fadeOutSec: 0 }, 26.38)).toEqual({ endSec: 26.38, fadeOutSec: MUSIC_TRIM_FADE_OUT_SEC })
    expect(trimMusicPatch({}, 26.38)).toEqual({ endSec: 26.38, fadeOutSec: 0.5 })
  })

  it('制作者が決めたフェードアウトは変えない', () => {
    expect(trimMusicPatch({ fadeOutSec: 2 }, 26.38)).toEqual({ endSec: 26.38 })
  })
})

describe('曲の終わりの検証', () => {
  it('秒で受け、null で自然な終わりへ戻す', () => {
    expect(UpdateMusicTrackPatch.parse({ endSec: 26.38 })).toEqual({ endSec: 26.38 })
    expect(UpdateMusicTrackPatch.parse({ endSec: null })).toEqual({ endSec: null })
  })

  it('0 以下・数でないものは弾く（0 で止めると曲が鳴らない）', () => {
    expect(UpdateMusicTrackPatch.safeParse({ endSec: 0 }).success).toBe(false)
    expect(UpdateMusicTrackPatch.safeParse({ endSec: -1 }).success).toBe(false)
    expect(UpdateMusicTrackPatch.safeParse({ endSec: Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(UpdateMusicTrackPatch.safeParse({ endSec: '26' }).success).toBe(false)
  })

  it('楽曲そのものでも同じ制約。無ければ自然な終わり', () => {
    const base = {
      id: '01J0000000000000000000000A',
      projectId: '01J0000000000000000000000B',
      mediaAssetId: '01J0000000000000000000000C',
      title: '曲',
    }
    expect(MusicTrack.parse(base).endSec ?? null).toBeNull()
    expect(MusicTrack.parse({ ...base, endSec: 26.38 }).endSec).toBe(26.38)
    expect(MusicTrack.safeParse({ ...base, endSec: 0 }).success).toBe(false)
  })
})
