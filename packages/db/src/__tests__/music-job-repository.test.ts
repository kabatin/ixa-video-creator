import { getTableConfig } from 'drizzle-orm/pg-core'
import { MusicJobId, MusicTrackId, ProjectId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { musicJobRowToDomain, type MusicJobRow } from '../repositories/music-job-repository.js'
import { musicJobs } from '../schema/music.js'

/** 曲を作るジョブ（ADR-0048）の行 → Domain。壊れた行を黙って読み替えないことを確かめる。 */
describe('music_jobs', () => {
  const row: MusicJobRow = {
    id: newId(MusicJobId),
    projectId: newId(ProjectId),
    tool: 'ace_step',
    model: 'ace_step/ace-step-1.5',
    spec: {
      prompt: 'j-pop, upbeat',
      lyrics: '',
      durationSec: 60,
      instrumental: true,
      seed: null,
      count: 2,
      title: null,
    },
    status: 'succeeded',
    error: null,
    providerRecord: { workflow: 'ace-step-1.5' },
    musicTrackIds: [newId(MusicTrackId), newId(MusicTrackId)],
    queuedAt: new Date('2026-10-17T00:00:00Z'),
    startedAt: new Date('2026-10-17T00:00:01Z'),
    finishedAt: new Date('2026-10-17T00:01:30Z'),
  }

  it('行をジョブにする', () => {
    expect(musicJobRowToDomain(row)).toMatchObject({ status: 'succeeded', tool: 'ace_step', spec: { count: 2 } })
  })

  it('範囲の外の指定が残っていたら失敗する（黙って読み替えない）', () => {
    expect(() => musicJobRowToDomain({ ...row, spec: { ...row.spec, count: 5 } })).toThrow()
    expect(() => musicJobRowToDomain({ ...row, spec: { ...row.spec, durationSec: 241 } })).toThrow()
  })

  it('できた楽曲の列は既定で空（成功するまで無い）', () => {
    const column = getTableConfig(musicJobs).columns.find((c) => c.name === 'music_track_ids')
    expect(column?.notNull).toBe(true)
    expect(column?.default).toEqual([])
  })
})
