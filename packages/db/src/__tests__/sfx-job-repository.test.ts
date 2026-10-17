import { getTableConfig } from 'drizzle-orm/pg-core'
import { MediaAssetId, ProjectId, SfxJobId, TimelineClipId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { sfxJobRowToDomain, type SfxJobRow } from '../repositories/sfx-job-repository.js'
import { sfxJobs } from '../schema/sfx.js'

/** 効果音を作るジョブ（ADR-0052）の行 → Domain。壊れた行を黙って読み替えないことを確かめる。 */
describe('sfx_jobs', () => {
  const row: SfxJobRow = {
    id: newId(SfxJobId),
    projectId: newId(ProjectId),
    tool: 'stable_audio_sfx',
    model: 'sfx_api/stable-audio-3-sfx',
    spec: { cue: { startSec: 3.75, durationSec: 1, prompt: 'cinematic impact hit', volume: 0.8 }, count: 2, seed: null },
    status: 'succeeded',
    error: null,
    providerRecord: { workflow: 'stable-audio-3-sfx' },
    mediaAssetIds: [newId(MediaAssetId), newId(MediaAssetId)],
    timelineClipId: newId(TimelineClipId),
    queuedAt: new Date('2026-10-18T00:00:00Z'),
    startedAt: new Date('2026-10-18T00:00:01Z'),
    finishedAt: new Date('2026-10-18T00:00:03Z'),
  }

  it('行をジョブにする', () => {
    expect(sfxJobRowToDomain(row)).toMatchObject({ status: 'succeeded', tool: 'stable_audio_sfx', spec: { count: 2 } })
    expect(sfxJobRowToDomain({ ...row, status: 'queued', mediaAssetIds: [], timelineClipId: null }).timelineClipId).toBeNull()
  })

  it('範囲の外の指定が残っていたら失敗する（黙って読み替えない）', () => {
    expect(() => sfxJobRowToDomain({ ...row, spec: { ...row.spec, count: 5 } })).toThrow()
    expect(() => sfxJobRowToDomain({ ...row, spec: { ...row.spec, cue: { ...row.spec.cue, durationSec: 11 } } })).toThrow()
    expect(() => sfxJobRowToDomain({ ...row, spec: { ...row.spec, cue: { ...row.spec.cue, prompt: '衝撃音' } } })).toThrow()
    expect(() => sfxJobRowToDomain({ ...row, status: 'done' as never })).toThrow()
  })

  it('できた素材の列は既定で空。クリップは外部キーにしない（人が消せる）', () => {
    const { columns, foreignKeys } = getTableConfig(sfxJobs)
    const assets = columns.find((c) => c.name === 'media_asset_ids')
    expect(assets?.notNull).toBe(true)
    expect(assets?.default).toEqual([])
    expect(columns.find((c) => c.name === 'timeline_clip_id')?.notNull).toBe(false)
    expect(foreignKeys.map((fk) => fk.reference().columns.map((c) => c.name)).flat()).toEqual(['project_id'])
  })
})
