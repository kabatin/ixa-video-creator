import { describe, expect, it } from 'vitest'
import {
  MediaAssetId,
  MusicTrackId,
  ProjectId,
  newId,
} from '@ixa/domain'
import type { MusicTrackRow } from '../repositories/music-track-repository.js'
import { musicTrackRowToDomain } from '../repositories/music-track-repository.js'

const baseRow = (overrides: Partial<MusicTrackRow> = {}): MusicTrackRow => ({
  id: newId(MusicTrackId),
  projectId: newId(ProjectId),
  mediaAssetId: newId(MediaAssetId),
  title: 'iXA CUP Theme',
  isMaster: true,
  offsetSec: 0,
  volume: 1,
  deletedAt: null,
  ...overrides,
})

describe('musicTrackRowToDomain', () => {
  it('row を MusicTrack に変換する', () => {
    const row = baseRow()
    const track = musicTrackRowToDomain(row)

    expect(track.id).toBe(row.id)
    expect(track.projectId).toBe(row.projectId)
    expect(track.title).toBe('iXA CUP Theme')
    expect(track.isMaster).toBe(true)
  })

  it('マスターでない音源も変換できる', () => {
    expect(musicTrackRowToDomain(baseRow({ isMaster: false })).isMaster).toBe(false)
  })

  it('オフセットと音量をそのまま持つ', () => {
    const track = musicTrackRowToDomain(baseRow({ offsetSec: 1.5, volume: 0.8 }))

    expect(track.offsetSec).toBe(1.5)
    expect(track.volume).toBe(0.8)
  })
})
