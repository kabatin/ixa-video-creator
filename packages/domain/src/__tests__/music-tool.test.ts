import { describe, expect, it } from 'vitest'
import { MUSIC_DURATION_MAX_SEC, MUSIC_DURATION_MIN_SEC, STABLE_AUDIO_MUSIC_DURATION_MAX_SEC } from '../music/music-job.js'
import { MUSIC_VOCAL_FALLBACK_TOOL, decideMusicTool, musicSpecProblem, musicToolLimits } from '../music/music-tool.js'

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

/**
 * 振り分け（制作者 2026-10-19）。既定の Stable Audio に歌ありが来たら、ACE-Step が使えるならそちらで作る。
 * 使えないときだけ断る。
 */
describe('decideMusicTool', () => {
  const vocal = { lyrics: '[verse]\nはしれ', instrumental: false, durationSec: 60 }
  const usable = (...tools: string[]) => (tool: string) => tools.includes(tool)

  it('歌える AI は ACE-Step', () => {
    expect(MUSIC_VOCAL_FALLBACK_TOOL).toBe('ace_step')
  })

  it('選んだ AI で作れるならそのまま（回さない）', () => {
    expect(decideMusicTool('stable_audio_medium_music', instrumental, usable('ace_step'))).toEqual({
      state: 'ready',
      tool: 'stable_audio_medium_music',
      rerouted: false,
    })
    expect(decideMusicTool('ace_step', vocal, usable())).toEqual({ state: 'ready', tool: 'ace_step', rerouted: false })
  })

  it('Stable Audio に歌あり（歌詞あり・なし）が来て ACE-Step が使えれば、ACE-Step に回す', () => {
    const rerouted = { state: 'ready', tool: 'ace_step', rerouted: true }
    expect(decideMusicTool('stable_audio_medium_music', vocal, usable('ace_step'))).toEqual(rerouted)
    expect(decideMusicTool('stable_audio_medium_music', { ...vocal, lyrics: '' }, usable('ace_step'))).toEqual(rerouted)
    // 歌ありなら長さは ACE-Step の範囲（240 秒まで）。
    expect(decideMusicTool('stable_audio_medium_music', { ...vocal, durationSec: 240 }, usable('ace_step'))).toEqual(rerouted)
  })

  it('ACE-Step が使えなければ、今までどおりの理由で断る', () => {
    expect(decideMusicTool('stable_audio_medium_music', vocal, usable())).toEqual({
      state: 'rejected',
      reason: musicSpecProblem('stable_audio_medium_music', vocal),
    })
  })

  it('ACE-Step でも作れない歌あり（240 秒超）は、ACE-Step の理由で断る', () => {
    const decision = decideMusicTool('stable_audio_medium_music', { ...vocal, durationSec: 241 }, usable('ace_step'))
    expect(decision).toMatchObject({ state: 'rejected' })
    expect(decision.state === 'rejected' ? decision.reason : '').toMatch(/ACE-Step 1.5 で作れる長さは 10〜240 秒/)
  })

  it('歌なしの頼みは回さない（歌詞だけ付いている・190 秒超は Stable Audio の理由で断る）', () => {
    expect(decideMusicTool('stable_audio_medium_music', { ...instrumental, lyrics: 'あ' }, usable('ace_step'))).toMatchObject({
      state: 'rejected',
      reason: expect.stringMatching(/歌詞は使えません/) as unknown,
    })
    expect(decideMusicTool('stable_audio_medium_music', { ...instrumental, durationSec: 200 }, usable('ace_step'))).toMatchObject({
      state: 'rejected',
      reason: expect.stringMatching(/10〜190 秒/) as unknown,
    })
  })
})
