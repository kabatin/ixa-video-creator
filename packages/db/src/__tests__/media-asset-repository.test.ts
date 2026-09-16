import { describe, expect, it } from 'vitest'
import { MediaAssetId, ProjectId, TakeId, WorkspaceId, newId } from '@ixa/domain'
import { CreateMediaAssetInput, UpdateMediaAssetPatch } from '@ixa/domain'
import type { MediaAssetRow } from '../repositories/media-asset-repository.js'
import { mediaAssetRowToDomain } from '../repositories/media-asset-repository.js'

const SHA256 = 'a'.repeat(64)

const baseRow = (): MediaAssetRow => ({
  id: newId(MediaAssetId),
  workspaceId: newId(WorkspaceId),
  projectId: newId(ProjectId),
  kind: 'video',
  storageKey: 'ws/proj/take.mp4',
  mimeType: 'video/mp4',
  bytes: 1024,
  checksumSha256: SHA256,
  probe: { durationSec: 5, width: 1920, height: 1080, fps: 24, hasAudio: false, codec: 'h264' },
  proxyKey: null,
  thumbnailKey: 'ws/proj/take.jpg',
  posterKeys: ['a.jpg', 'b.jpg'],
  origin: { type: 'generated', takeId: newId(TakeId) },
  tags: ['footage'],
  createdAt: new Date('2026-09-16T00:00:00Z'),
  deletedAt: null,
})

describe('mediaAssetRowToDomain', () => {
  it('row を MediaAsset に変換し、deletedAt を外へ出さない', () => {
    const row = baseRow()
    const asset = mediaAssetRowToDomain(row)
    expect(asset.id).toBe(row.id)
    expect(asset.origin).toEqual(row.origin)
    expect(asset.probe).toEqual(row.probe)
    expect(asset.posterKeys).toEqual(['a.jpg', 'b.jpg'])
    expect('deletedAt' in asset).toBe(false)
  })

  it('ライブラリ資産（projectId null）を許容する', () => {
    const asset = mediaAssetRowToDomain({ ...baseRow(), projectId: null, probe: null })
    expect(asset.projectId).toBeNull()
    expect(asset.probe).toBeNull()
  })

  it('不正な origin（JSONB）は投げる', () => {
    const row = { ...baseRow(), origin: { type: 'unknown' } as unknown as MediaAssetRow['origin'] }
    expect(() => mediaAssetRowToDomain(row)).toThrow()
  })

  it('不正な checksum 長は投げる', () => {
    expect(() => mediaAssetRowToDomain({ ...baseRow(), checksumSha256: 'abc' })).toThrow()
  })
})

describe('CreateMediaAssetInput', () => {
  it('派生物を省略できる', () => {
    const parsed = CreateMediaAssetInput.parse({
      workspaceId: newId(WorkspaceId),
      projectId: null,
      kind: 'image',
      storageKey: 'k',
      mimeType: 'image/png',
      bytes: 1,
      checksumSha256: SHA256,
      origin: { type: 'upload', uploadedBy: 'user' },
    })
    expect(parsed.probe).toBeNull()
    expect(parsed.proxyKey).toBeNull()
    expect(parsed.thumbnailKey).toBeNull()
    expect(parsed.posterKeys).toEqual([])
    expect(parsed.tags).toEqual([])
  })
})

describe('UpdateMediaAssetPatch', () => {
  it('実体（storageKey / checksum / origin）を変更できない', () => {
    const parsed = UpdateMediaAssetPatch.parse({
      proxyKey: 'p', storageKey: 'hack', checksumSha256: SHA256, origin: { type: 'upload' },
    })
    expect(parsed).toEqual({ proxyKey: 'p' })
  })
})
