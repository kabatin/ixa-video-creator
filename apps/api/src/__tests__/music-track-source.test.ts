import { MusicJob, MusicJobId, MusicTrackId, ProjectId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { musicTrackSourceOf } from '../music/track-source.js'

/** 楽曲から、作ったジョブの頼み方を引き当てる（プロンプトビューア）。楽曲はジョブを指していない。 */

const aJob = (musicTrackIds: readonly MusicTrackId[], patch: Partial<MusicJob['spec']> = {}): MusicJob =>
  MusicJob.parse({
    id: newId(MusicJobId),
    projectId: newId(ProjectId),
    tool: 'ace_step',
    model: null,
    spec: { prompt: 'city pop', lyrics: '', durationSec: 30, instrumental: true, seed: null, count: 1, title: null, ...patch },
    status: 'succeeded',
    error: null,
    providerRecord: null,
    musicTrackIds,
    queuedAt: new Date('2026-10-25T00:00:00Z'),
    startedAt: null,
    finishedAt: new Date('2026-10-25T00:01:00Z'),
  })

describe('musicTrackSourceOf', () => {
  it('その曲を含むジョブの曲調・歌詞・種・AI・作り終えた日時を返す', () => {
    const track = newId(MusicTrackId)
    const other = newId(MusicTrackId)
    const jobs = [aJob([other], { prompt: '別の曲' }), aJob([newId(MusicTrackId), track], { prompt: 'j-pop', lyrics: 'いけ', seed: 7, instrumental: false })]

    expect(musicTrackSourceOf(track, jobs)).toEqual({
      prompt: 'j-pop',
      lyrics: 'いけ',
      instrumental: false,
      seed: 7,
      durationSec: 30,
      tool: 'ace_step',
      model: null,
      createdAt: '2026-10-25T00:01:00.000Z',
    })
  })

  it('どのジョブにも無い曲（持ち込み）は null', () => {
    expect(musicTrackSourceOf(newId(MusicTrackId), [aJob([newId(MusicTrackId)])])).toBeNull()
    expect(musicTrackSourceOf(newId(MusicTrackId), [])).toBeNull()
  })
})
