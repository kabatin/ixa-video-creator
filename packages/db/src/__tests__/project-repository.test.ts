import { describe, expect, it } from 'vitest'
import { ProjectId, WorkspaceId, newId } from '@ixa/domain'
import { UpdateProjectPatch } from '@ixa/domain'
import type { ProjectRow } from '../repositories/project-repository.js'
import { projectRowToDomain } from '../repositories/project-repository.js'

const baseRow = (): ProjectRow => ({
  id: newId(ProjectId),
  workspaceId: newId(WorkspaceId),
  name: 'iXA CUP MUSIC VIDEO',
  fps: 24,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  durationSec: 116,
  budgetUsd: 50,
  styleGuide: 'cinematic',
  avoid: '文字、透かし',
  styleReferenceAssetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
  lyrics: '夜明けの屋上で\n君を待ってた',
  lyricCues: [12.5],
  status: 'planning',
  createdAt: new Date('2026-09-16T00:00:00Z'),
  updatedAt: new Date('2026-09-16T00:00:00Z'),
  deletedAt: null,
})

describe('projectRowToDomain', () => {
  it('row を Project に変換し、deletedAt を外へ出さない', () => {
    const row = baseRow()
    const project = projectRowToDomain(row)
    expect(project).toEqual({
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      fps: 24,
      resolution: { width: 1920, height: 1080 },
      aspectRatio: '16:9',
      durationSec: 116,
      budgetUsd: 50,
      styleGuide: 'cinematic',
      // 作品の方針（ADR-0030）。
      avoid: '文字、透かし',
      styleReferenceAssetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      // 歌詞（ADR-0033）。
      lyrics: '夜明けの屋上で\n君を待ってた',
      lyricCues: [12.5],
      status: 'planning',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
    expect('deletedAt' in project).toBe(false)
  })

  it('null 許容列を保持する', () => {
    const project = projectRowToDomain({ ...baseRow(), durationSec: null, budgetUsd: null })
    expect(project.durationSec).toBeNull()
    expect(project.budgetUsd).toBeNull()
  })

  it('不正な ID（非 ULID）は握り潰さず投げる', () => {
    expect(() => projectRowToDomain({ ...baseRow(), id: 'not-a-ulid' })).toThrow()
  })

  it('不正な status は投げる', () => {
    const row = { ...baseRow(), status: 'bogus' as ProjectRow['status'] }
    expect(() => projectRowToDomain(row)).toThrow()
  })
})

describe('UpdateProjectPatch', () => {
  it('id / workspaceId / createdAt を受け付けない', () => {
    const parsed = UpdateProjectPatch.parse({ name: 'x', id: 'y', workspaceId: 'z' })
    expect(parsed).toEqual({ name: 'x' })
  })

  it('不正な fps を拒否する', () => {
    expect(() => UpdateProjectPatch.parse({ fps: 23 })).toThrow()
  })
})
