import { describe, expect, it } from 'vitest'
import { MUSIC_DURATION_MAX_SEC, MUSIC_DURATION_MIN_SEC, STABLE_AUDIO_MUSIC_DURATION_MAX_SEC } from '../music/music-job.js'
import { musicSpecProblem, musicToolLimits } from '../music/music-tool.js'

/** 曲の AI ごとの違い。Stable Audio は歌なしだけ・190 秒まで（sfx-api の `GET /v1/capabilities`）。 */
const instrumental = { lyrics: '', instrumental: true, durationSec: 30 }

describe('musicToolLimits', () => {
  it('ACE-Step は歌えて、長さは曲のジョブの範囲そのまま', () => {
    expect(musicToolLimits('ace_step')).toEqual({
      vocals: true,
      durationSec: { min: MUSIC_DURATION_MIN_SEC, max: MUSIC_DURATION_MAX_SEC },
    })
  })

  it('Stable Audio は歌えず、190 秒まで', () => {
    expect(STABLE_AUDIO_MUSIC_DURATION_MAX_SEC).toBe(190)
    expect(musicToolLimits('stable_audio_medium_music')).toEqual({
      vocals: false,
      durationSec: { min: MUSIC_DURATION_MIN_SEC, max: STABLE_AUDIO_MUSIC_DURATION_MAX_SEC },
    })
  })
})

describe('musicSpecProblem', () => {
  it('歌なし・歌詞なし・範囲内なら Stable Audio でも問題なし（端の値も）', () => {
    expect(musicSpecProblem('stable_audio_medium_music', instrumental)).toBeNull()
    expect(musicSpecProblem('stable_audio_medium_music', { ...instrumental, durationSec: 190 })).toBeNull()
    expect(musicSpecProblem('stable_audio_medium_music', { ...instrumental, durationSec: MUSIC_DURATION_MIN_SEC })).toBeNull()
  })

  /** 黙って歌を捨てない。断って、どうすればよいかを言う。 */
  it('Stable Audio に歌ありを頼むと断る', () => {
    expect(musicSpecProblem('stable_audio_medium_music', { ...instrumental, instrumental: false })).toMatch(
      /歌なしの曲だけ.*「歌なし」/,
    )
  })

  it('Stable Audio に歌詞を渡すと、歌なしでも断る（空白だけは歌詞とみなさない）', () => {
    expect(musicSpecProblem('stable_audio_medium_music', { ...instrumental, lyrics: '[verse]\nはしれ' })).toMatch(/歌詞は使えません/)
    expect(musicSpecProblem('stable_audio_medium_music', { ...instrumental, lyrics: ' \n ' })).toBeNull()
  })

  it('Stable Audio の上限を超える長さは断る（190.01 秒）', () => {
    expect(musicSpecProblem('stable_audio_medium_music', { ...instrumental, durationSec: 190.01 })).toMatch(/10〜190 秒/)
  })

  it('ACE-Step は歌あり・歌詞あり・240 秒でも問題なし（今までどおり）', () => {
    expect(musicSpecProblem('ace_step', { lyrics: '[verse]\nはしれ', instrumental: false, durationSec: 240 })).toBeNull()
  })
})
