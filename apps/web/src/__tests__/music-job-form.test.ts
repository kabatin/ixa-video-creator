import {
  MUSIC_COUNT_MAX,
  MUSIC_DURATION_MAX_SEC,
  MUSIC_DURATION_MIN_SEC,
  MUSIC_LYRICS_MAX_LENGTH,
  MUSIC_PROMPT_MAX_LENGTH,
  ProjectEvent,
  musicToolLimits,
  type MusicJobStatus,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { WireMusicJob } from '@/lib/music-job-api'
import {
  INITIAL_MUSIC_FORM,
  activeMusicJobs,
  describeMusicJob,
  musicJobAddedTracks,
  musicJobNotice,
  validateMusicForm,
  type MusicForm,
} from '@/lib/music-job-form'

/** 「曲を作る」（ADR-0048）の欄の確かめ・進み具合の言い方・出来事の知らせ。 */

const form = (patch: Partial<MusicForm> = {}): MusicForm => ({
  ...INITIAL_MUSIC_FORM,
  prompt: 'j-pop, upbeat',
  ...patch,
})

const errorsOf = (patch: Partial<MusicForm>) => {
  const result = validateMusicForm(form(patch))
  if (result.ok) throw new Error('通ってしまいました')
  return result.errors
}

describe('validateMusicForm', () => {
  it('既定の値（60 秒・1 曲・歌あり）で本文になる。曲調は前後の空白を落とす', () => {
    expect(validateMusicForm(form({ prompt: '  j-pop  ', lyrics: '[verse]\nあ' }))).toEqual({
      ok: true,
      body: { prompt: 'j-pop', lyrics: '[verse]\nあ', durationSec: 60, instrumental: false, count: 1 },
    })
  })

  it('歌なしなら歌詞は送らない（欄に残っていても）', () => {
    const result = validateMusicForm(form({ instrumental: true, lyrics: '[chorus]\nら' }))
    expect(result.ok && result.body.lyrics).toBe('')
  })

  it('歌なしなら、長すぎる歌詞が残っていても止めない', () => {
    expect(validateMusicForm(form({ instrumental: true, lyrics: 'あ'.repeat(MUSIC_LYRICS_MAX_LENGTH + 1) })).ok).toBe(true)
  })

  it('曲調が空（空白だけ）なら止める', () => {
    expect(errorsOf({ prompt: '   ' }).prompt).toContain('曲調を入れてください')
  })

  it('曲調の上限', () => {
    expect(validateMusicForm(form({ prompt: 'a'.repeat(MUSIC_PROMPT_MAX_LENGTH) })).ok).toBe(true)
    expect(errorsOf({ prompt: 'a'.repeat(MUSIC_PROMPT_MAX_LENGTH + 1) }).prompt).toBe('曲調は 1000 字までです')
  })

  it('歌詞の上限', () => {
    expect(validateMusicForm(form({ lyrics: 'あ'.repeat(MUSIC_LYRICS_MAX_LENGTH) })).ok).toBe(true)
    expect(errorsOf({ lyrics: 'あ'.repeat(MUSIC_LYRICS_MAX_LENGTH + 1) }).lyrics).toBe('歌詞は 4000 字までです')
  })

  it('長さは 10〜240 秒。端は通し、外と空と数でないものは止める', () => {
    expect(validateMusicForm(form({ durationSec: String(MUSIC_DURATION_MIN_SEC) })).ok).toBe(true)
    expect(validateMusicForm(form({ durationSec: String(MUSIC_DURATION_MAX_SEC) })).ok).toBe(true)
    for (const bad of ['9.9', '240.5', '', 'abc']) {
      expect(errorsOf({ durationSec: bad }).durationSec).toBe('長さは 10〜240 秒で入れてください')
    }
  })

  it('何曲は 1〜4 の整数', () => {
    expect(validateMusicForm(form({ count: String(MUSIC_COUNT_MAX) })).ok).toBe(true)
    for (const bad of ['0', '5', '1.5', '']) {
      expect(errorsOf({ count: bad }).count).toBe('何曲作るかは 1〜4 で選んでください')
    }
  })

  /** ADR-0048 追記。歌なしだけの AI では、欄の「歌なし」を外せない。長さの上限もその AI のもの。 */
  it('歌なしだけの AI（Stable Audio）なら、歌ありのままでも歌なし・歌詞なしで頼む', () => {
    const stableAudio = musicToolLimits('stable_audio_medium_music')
    expect(validateMusicForm(form({ instrumental: false, lyrics: '[verse]\nあ' }), stableAudio)).toEqual({
      ok: true,
      body: { prompt: 'j-pop, upbeat', lyrics: '', durationSec: 60, instrumental: true, count: 1 },
    })
  })

  it('Stable Audio の長さは 10〜190 秒', () => {
    const stableAudio = musicToolLimits('stable_audio_medium_music')
    expect(validateMusicForm(form({ durationSec: '190' }), stableAudio).ok).toBe(true)
    const result = validateMusicForm(form({ durationSec: '190.5' }), stableAudio)
    expect(result.ok ? null : result.errors.durationSec).toBe('長さは 10〜190 秒で入れてください')
  })

  it('いくつも違反していれば、欄ごとに全部言う', () => {
    expect(Object.keys(errorsOf({ prompt: '', durationSec: '1', count: '9' })).sort()).toEqual([
      'count',
      'durationSec',
      'prompt',
    ])
  })
})

const job = (status: MusicJobStatus, patch: Partial<WireMusicJob> = {}): WireMusicJob => ({
  id: `job-${status}`,
  status,
  prompt: 'j-pop',
  durationSec: 60,
  instrumental: false,
  count: 2,
  title: null,
  musicTrackIds: [],
  error: null,
  queuedAt: '2026-10-17T00:00:00.000Z',
  finishedAt: null,
  ...patch,
})

describe('activeMusicJobs / describeMusicJob', () => {
  it('終わっていないジョブだけ残す', () => {
    const jobs = (['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const).map((s) => job(s))
    expect(activeMusicJobs(jobs).map((j) => j.status)).toEqual(['queued', 'running'])
  })

  it('待っている・作っているを言い分け、長さは format-time の書式で言う', () => {
    expect(describeMusicJob(job('queued'))).toBe('順番を待っています…（2 曲・1:00.00（60.00s））')
    expect(describeMusicJob(job('running', { durationSec: 30, count: 1 }))).toBe('曲を作っています…（1 曲・30.00s）')
  })
})

const event = (status: MusicJobStatus, musicTrackIds: readonly string[] = [], error: string | null = null) => {
  const parsed = ProjectEvent.parse({
    type: 'music_job.status',
    projectId: '01J9ZK3V8Q4W6N2T5R7Y1X3C9A',
    at: '2026-10-17T00:00:00.000Z',
    jobId: '01J9ZK3V8Q4W6N2T5R7Y1X3C9B',
    status,
    musicTrackIds,
    error,
  })
  if (parsed.type !== 'music_job.status') throw new Error('曲のジョブの出来事ではありません')
  return parsed
}

describe('musicJobNotice', () => {
  it('できたら何曲足したかを言う', () => {
    expect(musicJobNotice(event('succeeded', ['01J9ZK3V8Q4W6N2T5R7Y1X3C9C', '01J9ZK3V8Q4W6N2T5R7Y1X3C9D']))).toBe(
      '曲ができました。楽曲に 2 曲足しました（解析を始めています）。',
    )
  })

  it('失敗は理由ごと言う。理由が無くても失敗は落とさない', () => {
    expect(musicJobNotice(event('failed', [], '手元の ACE-Step に繋がりません'))).toBe(
      '曲を作れませんでした: 手元の ACE-Step に繋がりません',
    )
    expect(musicJobNotice(event('failed'))).toBe('曲を作れませんでした: 理由が届きませんでした。')
  })

  it('途中・止めたときは知らせない', () => {
    expect(musicJobNotice(event('queued'))).toBeNull()
    expect(musicJobNotice(event('running'))).toBeNull()
    expect(musicJobNotice(event('cancelled'))).toBeNull()
  })

  it('止めたのに間に合わず楽曲を足していたら、足したことを言う（黙ると一覧に増えた理由が分からない）', () => {
    expect(musicJobNotice(event('cancelled', ['01J9ZK3V8Q4W6N2T5R7Y1X3C9C']))).toBe(
      '曲を作るのを止めましたが、間に合わず楽曲に 1 曲足しました。',
    )
  })
})

describe('musicJobAddedTracks', () => {
  it('楽曲を足した知らせなら（できた・止めたが間に合わなかった）楽曲の一覧を読み直す', () => {
    expect(musicJobAddedTracks(event('succeeded', ['01J9ZK3V8Q4W6N2T5R7Y1X3C9C']))).toBe(true)
    expect(musicJobAddedTracks(event('cancelled', ['01J9ZK3V8Q4W6N2T5R7Y1X3C9C']))).toBe(true)
  })

  it('楽曲を足していなければ読み直さない', () => {
    expect(musicJobAddedTracks(event('running'))).toBe(false)
    expect(musicJobAddedTracks(event('cancelled'))).toBe(false)
    expect(musicJobAddedTracks(event('failed', [], '落ちた'))).toBe(false)
  })
})
