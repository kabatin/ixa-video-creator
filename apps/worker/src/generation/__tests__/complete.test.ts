import { TakeId as TakeIdSchema, createPhase1EmptyContextSource, newId } from '@ixa/domain'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it, vi } from 'vitest'
import { extensionFromUrl, mediaKindFor, recordTake, type RecordTakeDeps } from '../complete.js'
import { NO_LINEAGE } from '../lineage.js'
import type { DownloadedObject } from '../download.js'
import { rebuildSpec } from '../spec.js'
import { aProject, aShot, inMemoryMediaAssets, inMemoryTakes, testModel } from './doubles.js'

const MODEL = testModel()
const CHECKSUM = 'b'.repeat(64)

const fakeDownload = (key: string): Promise<DownloadedObject> =>
  Promise.resolve({
    storageKey: key,
    bytes: 4096,
    contentType: 'video/mp4',
    checksumSha256: CHECKSUM,
  })

const buildFixture = async () => {
  const project = aProject()
  const shot = aShot(project)
  const { spec, specHash } = await rebuildSpec(
    createPhase1EmptyContextSource(),
    shot,
    project,
    MODEL,
  )

  const takes = inMemoryTakes()
  const mediaAssets = inMemoryMediaAssets()
  const download = vi.fn((options: { key: string }) => fakeDownload(options.key))

  const deps: RecordTakeDeps = {
    takes,
    mediaAssets,
    storage: createMemoryStorage(),
    download,
  }

  const input = {
    shot,
    project,
    spec,
    specHash,
    providerId: MODEL.providerId,
    modelId: MODEL.id,
    output: { type: 'remote' as const, url: 'https://cdn.example.com/out.mp4' },
    seedUsed: 4242,
    costUsd: 0.4,
    raw: { id: 'provider-job-1' },
    generationTimeSec: 42,
    lineage: NO_LINEAGE,
  }

  return { deps, input, takes, mediaAssets, download, project, shot }
}

describe('recordTake', () => {
  it('MediaAsset と Take を作り、origin.takeId が Take の id と一致する', async () => {
    const f = await buildFixture()

    const take = await recordTake(f.deps, f.input)

    expect(f.takes.snapshot()).toHaveLength(1)
    expect(f.mediaAssets.snapshot()).toHaveLength(1)

    const asset = f.mediaAssets.snapshot()[0]
    expect(asset?.id).toBe(take.mediaAssetId)
    expect(asset?.origin).toEqual({ type: 'generated', takeId: take.id })
    expect(asset?.storageKey).toContain(take.mediaAssetId)
    expect(asset?.checksumSha256).toBe(CHECKSUM)
  })

  it('同じ内容を 2 回取り込んでも Take も MediaAsset も増えない', async () => {
    const f = await buildFixture()

    const first = await recordTake(f.deps, f.input)
    const second = await recordTake(f.deps, f.input)

    expect(second.id).toBe(first.id)
    expect(f.takes.snapshot()).toHaveLength(1)
    expect(f.mediaAssets.snapshot()).toHaveLength(1)
  })

  it('MediaAsset を作った直後に落ちた場合、次回は孤児の takeId で Take だけを作る', async () => {
    const f = await buildFixture()

    // 前回の試行が MediaAsset まで書いて Take の前に落ちた状態を作る
    const orphanTakeId = newId(TakeIdSchema)
    const orphanAsset = await f.mediaAssets.create({
      workspaceId: f.project.workspaceId,
      projectId: f.project.id,
      kind: 'video',
      storageKey: 'media/WS/ORPHAN/original.mp4',
      mimeType: 'video/mp4',
      bytes: 4096,
      checksumSha256: CHECKSUM,
      origin: { type: 'generated', takeId: orphanTakeId },
      tags: [],
    })

    const take = await recordTake(f.deps, f.input)

    expect(take.id).toBe(orphanTakeId)
    expect(take.mediaAssetId).toBe(orphanAsset.id)
    expect(f.takes.snapshot()).toHaveLength(1)
    // MediaAsset は増えない（重複行を作らない）
    expect(f.mediaAssets.snapshot()).toHaveLength(1)
  })
})

describe('recordTake（系譜）', () => {
  it('通常の生成では parentTakeId も regenerationReason も null のまま', async () => {
    const f = await buildFixture()

    const take = await recordTake(f.deps, f.input)

    expect(take.parentTakeId).toBeNull()
    expect(take.regenerationReason).toBeNull()
  })

  it('再生成では親と理由を Take に入れる', async () => {
    const f = await buildFixture()
    const parentTakeId = newId(TakeIdSchema)

    const take = await recordTake(f.deps, {
      ...f.input,
      lineage: { parentTakeId, regenerationReason: 'character_consistency: 顔が崩れている' },
    })

    expect(take.parentTakeId).toBe(parentTakeId)
    expect(take.regenerationReason).toBe('character_consistency: 顔が崩れている')
  })

  it('親を辿れない再生成でも理由だけは残す', async () => {
    const f = await buildFixture()

    const take = await recordTake(f.deps, {
      ...f.input,
      lineage: { parentTakeId: null, regenerationReason: 'motion: 動きが破綻している' },
    })

    expect(take.parentTakeId).toBeNull()
    expect(take.regenerationReason).toBe('motion: 動きが破綻している')
  })

  it('取り込み済みの Take を再利用するときは既存の系譜を書き換えない（ADR-0003）', async () => {
    const f = await buildFixture()
    const parentTakeId = newId(TakeIdSchema)

    const first = await recordTake(f.deps, {
      ...f.input,
      lineage: { parentTakeId, regenerationReason: '最初に記録した理由' },
    })
    // 同じ checksum で、別の系譜を主張して呼び直す
    const second = await recordTake(f.deps, {
      ...f.input,
      lineage: { parentTakeId: newId(TakeIdSchema), regenerationReason: '後から来た別の理由' },
    })

    expect(second.id).toBe(first.id)
    expect(second.parentTakeId).toBe(parentTakeId)
    expect(second.regenerationReason).toBe('最初に記録した理由')
    expect(f.takes.snapshot()).toHaveLength(1)
  })
})

describe('recordTake（ローカル出力）', () => {
  it('ローカル Provider のファイルを HTTP を経由せず取り込む', async () => {
    const f = await buildFixture()
    const dir = await mkdtemp(join(tmpdir(), 'ixa-take-'))
    const filePath = join(dir, 'out.mp4')
    await writeFile(filePath, new Uint8Array(2048).fill(3))

    try {
      const take = await recordTake(f.deps, {
        ...f.input,
        output: { type: 'local', path: filePath },
      })

      const asset = f.mediaAssets.snapshot()[0]
      expect(asset?.id).toBe(take.mediaAssetId)
      // storageKey が正しく入っていること（key という別名で返していた不具合の回帰テスト）
      expect(asset?.storageKey).toContain(take.mediaAssetId)
      expect(asset?.bytes).toBe(2048)
      expect(asset?.mimeType).toBe('video/mp4')
      expect(await f.deps.storage.head(asset?.storageKey ?? '')).toMatchObject({ bytes: 2048 })
      // ダウンロード経路は使わない
      expect(f.download).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('ローカル出力もサイズ上限を超えたら失敗する', async () => {
    const f = await buildFixture()
    const dir = await mkdtemp(join(tmpdir(), 'ixa-take-'))
    const filePath = join(dir, 'huge.mp4')
    await writeFile(filePath, new Uint8Array(4096))

    try {
      await expect(
        recordTake(
          { ...f.deps, maxBytes: 100 },
          { ...f.input, output: { type: 'local', path: filePath } },
        ),
      ).rejects.toThrow(/大きすぎます/)
      expect(f.mediaAssets.snapshot()).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('extensionFromUrl', () => {
  it('URL の拡張子を使い、判別できなければ mp4 にする', () => {
    expect(extensionFromUrl('/var/tmp/ixa/out.webm')).toBe('webm')
    expect(extensionFromUrl('https://cdn.example.com/a/out.webm')).toBe('webm')
    expect(extensionFromUrl('https://cdn.example.com/out.mp4?sig=abc')).toBe('mp4')
    expect(extensionFromUrl('https://cdn.example.com/out')).toBe('mp4')
    expect(extensionFromUrl('not a url')).toBe('mp4')
    expect(extensionFromUrl('https://cdn.example.com/out.tar.gz')).toBe('gz')
  })
})

describe('mediaKindFor', () => {
  it('contentType から kind を決める', () => {
    expect(mediaKindFor('image/png')).toBe('image')
    expect(mediaKindFor('video/mp4')).toBe('video')
  })
})

describe('rebuildSpec', () => {
  it('モデルの対応値へ尺を切り上げる（ADR-0011）', async () => {
    const project = aProject()
    const shot = aShot(project)

    const { spec } = await rebuildSpec(createPhase1EmptyContextSource(), shot, project, MODEL)

    expect(shot.durationSec).toBe(3.75)
    expect(spec.durationSec).toBe(4)
    expect(spec.aspectRatio).toBe('16:9')
    expect(spec.fps).toBe(30)
  })
})
