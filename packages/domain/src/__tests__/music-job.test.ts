import { describe, expect, it } from 'vitest'
import { MusicJobId, MusicTrackId, ProjectId, newId } from '../common/ids.js'
import { ProjectEvent, SHOT_LIST_EVENT_TYPES } from '../events/project-event.js'
import { MediaOrigin } from '../media/media-asset.js'
import { MusicJobSpec, isMusicJobFinished, musicTrackTitle, type MusicJobSpec as Spec } from '../music/music-job.js'

/** 曲を作るジョブ（ADR-0048）。範囲は ace-step-api の契約と同じ。 */
const aSpec = (overrides: Partial<Spec> = {}): Spec => ({
  prompt: 'j-pop, upbeat, female vocal',
  lyrics: '[verse]\nはしれ',
  durationSec: 60,
  instrumental: false,
  seed: null,
  count: 1,
  title: null,
  ...overrides,
})

describe('MusicJobSpec', () => {
  it('契約の範囲の値は受ける（端の値も）', () => {
    for (const spec of [
      aSpec(),
      aSpec({ durationSec: 10, count: 4, lyrics: '', instrumental: true, seed: 42 }),
      aSpec({ durationSec: 240, prompt: 'a'.repeat(1000), lyrics: 'あ'.repeat(4000) }),
    ]) {
      expect(MusicJobSpec.safeParse(spec).success).toBe(true)
    }
  })

  it.each([
    ['曲調が空', { prompt: '   ' }],
    ['曲調が 1000 字を超える', { prompt: 'a'.repeat(1001) }],
    ['歌詞が 4000 字を超える', { lyrics: 'あ'.repeat(4001) }],
    ['長さが 10 秒より短い', { durationSec: 9 }],
    ['長さが 240 秒より長い', { durationSec: 241 }],
    ['曲の数が 0', { count: 0 }],
    ['曲の数が 5', { count: 5 }],
    ['曲の数が小数', { count: 1.5 }],
    ['種が負', { seed: -1 }],
  ] as const)('%s は受けない', (_label, overrides) => {
    expect(MusicJobSpec.safeParse(aSpec(overrides)).success).toBe(false)
  })
})

describe('musicTrackTitle', () => {
  it('名前があればそれ、無ければ曲調の頭。複数曲なら番号を足す', () => {
    expect(musicTrackTitle(aSpec({ title: 'テーマ' }), 0)).toBe('テーマ')
    expect(musicTrackTitle(aSpec({ title: 'テーマ', count: 2 }), 1)).toBe('テーマ 2')
    expect(musicTrackTitle(aSpec({ prompt: 'x'.repeat(100) }), 0)).toBe('x'.repeat(40))
  })
})

describe('isMusicJobFinished', () => {
  it('成功・失敗・取消だけが終わり', () => {
    expect(['queued', 'running', 'succeeded', 'failed', 'cancelled'].map((s) => isMusicJobFinished(s as never))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ])
  })
})

describe('music_job.status', () => {
  it('ジョブ・状態・できた楽曲・失敗の理由を持ち、画面が受け取る出来事に入っている', () => {
    const event = {
      type: 'music_job.status',
      projectId: newId(ProjectId),
      at: new Date().toISOString(),
      jobId: newId(MusicJobId),
      status: 'succeeded',
      musicTrackIds: [newId(MusicTrackId)],
      error: null,
    }
    expect(ProjectEvent.parse(event)).toEqual(event)
    expect(SHOT_LIST_EVENT_TYPES).toContain('music_job.status')
  })
})

describe('MediaOrigin generated_music', () => {
  it('曲のジョブを指す', () => {
    const origin = { type: 'generated_music', musicJobId: newId(MusicJobId) }
    expect(MediaOrigin.parse(origin)).toEqual(origin)
  })
})
