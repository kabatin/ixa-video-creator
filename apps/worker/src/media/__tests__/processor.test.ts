import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStorage, posterKey, proxyKey, thumbnailKey } from '@ixa/storage'
import type { ObjectStorage } from '@ixa/storage'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_POSTER_COUNT, processMediaJob, type MediaOutcome } from '../processor.js'
import { inMemoryMediaAssets, readBytes, seedAsset, silentLogger } from './doubles.js'
import type { InMemoryMediaAssets } from './doubles.js'
import { makeTestAudio, makeTestImage, makeTestVideo } from './fixtures.js'

/**
 * 実 DB / 実ストレージには接続しない。ffmpeg だけはローカルの実物を使い、
 * 素材は testsrc / sine から毎回生成する。
 */

const FFMPEG_TIMEOUT_MS = 120_000

let fixtureDir: string
let videoBytes: Uint8Array
let imageBytes: Uint8Array
let audioBytes: Uint8Array

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'ixa-media-fixture-'))
  videoBytes = await readBytes(await makeTestVideo(fixtureDir))
  imageBytes = await readBytes(await makeTestImage(fixtureDir))
  audioBytes = await readBytes(await makeTestAudio(fixtureDir))
}, FFMPEG_TIMEOUT_MS)

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

describe('processMediaJob', () => {
  let repo: InMemoryMediaAssets
  let storage: ObjectStorage
  let workDir: string

  beforeEach(async () => {
    repo = inMemoryMediaAssets()
    storage = createMemoryStorage()
    workDir = await mkdtemp(join(tmpdir(), 'ixa-media-work-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  const deps = () => ({ mediaAssets: repo, storage, workDir, logger: silentLogger })

  /** workDir 直下に何も残っていないこと（＝ジョブ用の一時ディレクトリが消えたこと）。 */
  const workDirEntries = () => readdir(workDir)

  const processed = (outcome: MediaOutcome) => {
    expect(outcome.state).toBe('processed')
    return outcome as Extract<MediaOutcome, { state: 'processed' }>
  }

  it('video は probe / proxyKey / thumbnailKey / posterKeys をすべて埋める', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: videoBytes,
    })

    const outcome = processed(await processMediaJob(deps(), { mediaAssetId: asset.id }))
    expect(outcome.probe.width).toBe(320)
    expect(outcome.probe.height).toBe(240)
    expect(outcome.probe.hasAudio).toBe(true)
    expect(outcome.posterCount).toBe(DEFAULT_POSTER_COUNT)

    const [stored] = repo.snapshot()
    expect(stored?.probe).not.toBeNull()
    expect(stored?.proxyKey).toBe(proxyKey(asset.workspaceId, asset.id))
    expect(stored?.thumbnailKey).toBe(thumbnailKey(asset.workspaceId, asset.id))
    expect(stored?.posterKeys).toHaveLength(DEFAULT_POSTER_COUNT)
    expect(stored?.posterKeys[0]).toBe(posterKey(asset.workspaceId, asset.id, 0))

    // 生成物が本当にストレージへ入っていること
    await expect(storage.exists(proxyKey(asset.workspaceId, asset.id))).resolves.toBe(true)
    await expect(storage.exists(thumbnailKey(asset.workspaceId, asset.id))).resolves.toBe(true)
    await expect(storage.exists(posterKey(asset.workspaceId, asset.id, 4))).resolves.toBe(true)
  }, FFMPEG_TIMEOUT_MS)

  it('posterCount を指定するとその枚数だけ抽出する', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: videoBytes,
    })

    const outcome = processed(
      await processMediaJob({ ...deps(), posterCount: 2 }, { mediaAssetId: asset.id }),
    )

    expect(outcome.posterCount).toBe(2)
    expect(repo.snapshot()[0]?.posterKeys).toHaveLength(2)
  }, FFMPEG_TIMEOUT_MS)

  it('image はサムネイルだけを作り、プロキシもポスターも作らない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'image',
      ext: 'png',
      mimeType: 'image/png',
      body: imageBytes,
    })

    const outcome = processed(await processMediaJob(deps(), { mediaAssetId: asset.id }))
    expect(outcome.posterCount).toBe(0)

    const [stored] = repo.snapshot()
    expect(stored?.thumbnailKey).toBe(thumbnailKey(asset.workspaceId, asset.id))
    expect(stored?.proxyKey).toBeNull()
    expect(stored?.posterKeys).toEqual([])

    await expect(storage.exists(thumbnailKey(asset.workspaceId, asset.id))).resolves.toBe(true)
    await expect(storage.exists(proxyKey(asset.workspaceId, asset.id))).resolves.toBe(false)
    await expect(storage.exists(posterKey(asset.workspaceId, asset.id, 0))).resolves.toBe(false)
  }, FFMPEG_TIMEOUT_MS)

  it('audio は probe だけを入れ、画像系の生成物を一切作らない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'audio',
      ext: 'm4a',
      mimeType: 'audio/mp4',
      body: audioBytes,
    })

    const outcome = processed(await processMediaJob(deps(), { mediaAssetId: asset.id }))
    expect(outcome.probe.hasAudio).toBe(true)
    expect(outcome.probe.width).toBeNull()
    expect(outcome.posterCount).toBe(0)

    const [stored] = repo.snapshot()
    expect(stored?.probe).not.toBeNull()
    expect(stored?.proxyKey).toBeNull()
    expect(stored?.thumbnailKey).toBeNull()
    expect(stored?.posterKeys).toEqual([])

    await expect(storage.exists(thumbnailKey(asset.workspaceId, asset.id))).resolves.toBe(false)
    await expect(storage.exists(proxyKey(asset.workspaceId, asset.id))).resolves.toBe(false)
  }, FFMPEG_TIMEOUT_MS)

  it('取り込み済みの MediaAsset は skipped になる（冪等）', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: videoBytes,
    })
    await processMediaJob(deps(), { mediaAssetId: asset.id })
    const afterFirst = repo.updateCount()

    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    expect(outcome).toEqual({ state: 'skipped', reason: 'already_ingested' })
    // 2 回目は ffmpeg も update も走らない
    expect(repo.updateCount()).toBe(afterFirst)
  }, FFMPEG_TIMEOUT_MS)

  it('MediaAsset が無ければ throw する', async () => {
    await expect(
      processMediaJob(deps(), { mediaAssetId: '01JQ0000000000000000000000' }),
    ).rejects.toThrow(/MediaAsset が見つかりません/)
  })

  it('ジョブデータが不正なら throw する', async () => {
    await expect(processMediaJob(deps(), { mediaAssetId: 'not-an-ulid' })).rejects.toThrow()
  })

  it('原本が取得できなければ failed になり、MediaAsset を更新しない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: videoBytes,
      skipUpload: true,
    })

    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    expect(outcome.state).toBe('failed')
    expect(repo.updateCount()).toBe(0)
    const [stored] = repo.snapshot()
    expect(stored?.probe).toBeNull()
    expect(stored?.proxyKey).toBeNull()
    expect(stored?.thumbnailKey).toBeNull()
    expect(stored?.posterKeys).toEqual([])
  })

  it('壊れた素材は failed になり、部分的な生成物も更新も残さない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: new TextEncoder().encode('this is not a video'),
    })

    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    expect(outcome.state).toBe('failed')
    expect(repo.updateCount()).toBe(0)
    expect(repo.snapshot()[0]?.probe).toBeNull()
    await expect(storage.exists(proxyKey(asset.workspaceId, asset.id))).resolves.toBe(false)
    await expect(storage.exists(thumbnailKey(asset.workspaceId, asset.id))).resolves.toBe(false)
  }, FFMPEG_TIMEOUT_MS)

  it('成功しても一時ディレクトリを残さない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: videoBytes,
    })

    await expect(workDirEntries()).resolves.toEqual([])
    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    expect(outcome.state).toBe('processed')
    await expect(workDirEntries()).resolves.toEqual([])
  }, FFMPEG_TIMEOUT_MS)

  it('失敗しても一時ディレクトリを残さない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: new TextEncoder().encode('this is not a video'),
    })

    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    expect(outcome.state).toBe('failed')
    await expect(workDirEntries()).resolves.toEqual([])
  }, FFMPEG_TIMEOUT_MS)

  it('workDir が存在しなくても作ってから使い、後始末する', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'audio',
      ext: 'm4a',
      mimeType: 'audio/mp4',
      body: audioBytes,
    })
    const nested = join(workDir, 'nested', 'media')

    const outcome = await processMediaJob(
      { ...deps(), workDir: nested },
      { mediaAssetId: asset.id },
    )

    expect(outcome.state).toBe('processed')
    await expect(readdir(nested)).resolves.toEqual([])
  }, FFMPEG_TIMEOUT_MS)

  it('video の最終フレームが独立した MediaAsset として作られる（連続性の参照に使う）', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: videoBytes,
    })

    processed(await processMediaJob(deps(), { mediaAssetId: asset.id }))

    const source = repo.snapshot().find((a) => a.id === asset.id)
    expect(source?.lastFrameAssetId).not.toBeNull()

    const lastFrame = repo.snapshot().find((a) => a.id === source?.lastFrameAssetId)
    expect(lastFrame?.kind).toBe('image')
    expect(lastFrame?.origin).toEqual({
      type: 'derived',
      sourceAssetId: asset.id,
      operation: 'last_frame',
    })
    expect(lastFrame?.storageKey).toContain('last-frame.jpg')
    expect(lastFrame?.bytes).toBeGreaterThan(0)
    // 実体がストレージに置かれていること
    expect(await storage.exists(lastFrame?.storageKey as string)).toBe(true)
  }, FFMPEG_TIMEOUT_MS)

  it('image には最終フレームを作らない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'image',
      ext: 'png',
      mimeType: 'image/png',
      body: imageBytes,
    })
    processed(await processMediaJob(deps(), { mediaAssetId: asset.id }))
    expect(repo.snapshot().find((a) => a.id === asset.id)?.lastFrameAssetId).toBeNull()
    // 派生アセットが増えていないこと
    expect(repo.snapshot()).toHaveLength(1)
  }, FFMPEG_TIMEOUT_MS)
})
