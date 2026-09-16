import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RenderJobId as RenderJobIdSchema, newId, type MediaProbe } from '@ixa/domain'
import { createMemoryStorage, posterKey, proxyKey, thumbnailKey } from '@ixa/storage'
import type { ObjectStorage } from '@ixa/storage'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_POSTER_COUNT, processMediaJob } from '../processor.js'
import { inMemoryMediaAssets, readBytes, seedAsset, silentLogger } from './doubles.js'
import type { InMemoryMediaAssets } from './doubles.js'
import { makeTestVideo } from './fixtures.js'

/**
 * 冪等判定の回帰テスト。
 *
 * 取り込み済みかどうかを `probe` の有無で判断していたため、
 * render が自分で書き込んだ尺だけの probe によって media ジョブが skip され、
 * レンダリング結果からポスターフレームが 1 枚も抜かれていなかった。
 * skip は成功として返るため、この欠落は下流からは見えない。
 *
 * ここでは「render 由来の probe 付き MediaAsset が skip されないこと」を固定する。
 */

const FFMPEG_TIMEOUT_MS = 120_000

/**
 * render が `apps/worker/src/render/processor.ts` で書き込む probe と同じ形。
 * 尺だけが入り、解像度・コーデックは ffprobe に測らせるため null のまま。
 */
const renderWrittenProbe: MediaProbe = {
  durationSec: 1.5,
  width: null,
  height: null,
  fps: null,
  hasAudio: true,
  codec: null,
}

const renderedOrigin = () => ({ type: 'rendered', renderJobId: newId(RenderJobIdSchema) }) as const

describe('取り込み済み判定（ffmpeg 不要）', () => {
  let repo: InMemoryMediaAssets
  let storage: ObjectStorage
  let workDir: string

  beforeEach(async () => {
    repo = inMemoryMediaAssets()
    storage = createMemoryStorage()
    workDir = await mkdtemp(join(tmpdir(), 'ixa-media-guard-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  const deps = () => ({ mediaAssets: repo, storage, workDir, logger: silentLogger })

  /**
   * 原本をストレージへ置かないので取り込みは必ず failed になる。
   * ffmpeg を呼ばずに「skip されなかった」ことだけを確かめるための形。
   */
  const seedRenderedWithoutSource = () =>
    seedAsset(repo, storage, {
      kind: 'video',
      ext: 'mp4',
      mimeType: 'video/mp4',
      body: new TextEncoder().encode('placeholder'),
      skipUpload: true,
      probe: renderWrittenProbe,
      origin: renderedOrigin(),
    })

  it('probe が入っていても派生物が無い video は skip しない', async () => {
    const asset = await seedRenderedWithoutSource()

    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    // skipped ではなく failed。取り込みに進んだ証拠になる。
    expect(outcome.state).toBe('failed')
  })

  it('probe が入っていても派生物が無い image は skip しない', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'image',
      ext: 'png',
      mimeType: 'image/png',
      body: new TextEncoder().encode('placeholder'),
      skipUpload: true,
      probe: renderWrittenProbe,
    })

    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    expect(outcome.state).toBe('failed')
  })

  it('派生物を作らない audio は probe だけで取り込み済みと判定する', async () => {
    const asset = await seedAsset(repo, storage, {
      kind: 'audio',
      ext: 'm4a',
      mimeType: 'audio/mp4',
      body: new TextEncoder().encode('placeholder'),
      skipUpload: true,
      probe: renderWrittenProbe,
    })

    const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

    expect(outcome).toEqual({ state: 'skipped', reason: 'already_ingested' })
    expect(repo.updateCount()).toBe(0)
  })
})

describe('取り込み済み判定（実 ffmpeg）', () => {
  let fixtureDir: string
  let videoBytes: Uint8Array
  let repo: InMemoryMediaAssets
  let storage: ObjectStorage
  let workDir: string

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'ixa-media-guard-fixture-'))
    videoBytes = await readBytes(await makeTestVideo(fixtureDir))
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await rm(fixtureDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    repo = inMemoryMediaAssets()
    storage = createMemoryStorage()
    workDir = await mkdtemp(join(tmpdir(), 'ixa-media-guard-work-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  const deps = () => ({ mediaAssets: repo, storage, workDir, logger: silentLogger })

  it(
    'render が書いた probe 付きの video からもポスターフレームを抽出する',
    async () => {
      const asset = await seedAsset(repo, storage, {
        kind: 'video',
        ext: 'mp4',
        mimeType: 'video/mp4',
        body: videoBytes,
        probe: renderWrittenProbe,
        origin: renderedOrigin(),
      })

      const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

      expect(outcome.state).toBe('processed')

      const stored = repo.snapshot().find((a) => a.id === asset.id)
      expect(stored?.posterKeys).toHaveLength(DEFAULT_POSTER_COUNT)
      expect(stored?.proxyKey).toBe(proxyKey(asset.workspaceId, asset.id))
      expect(stored?.thumbnailKey).toBe(thumbnailKey(asset.workspaceId, asset.id))
      await expect(storage.exists(posterKey(asset.workspaceId, asset.id, 0))).resolves.toBe(true)

      // render が null のまま残した解像度・コーデックを ffprobe が埋め直すこと。
      expect(stored?.probe?.width).toBe(320)
      expect(stored?.probe?.height).toBe(240)
      expect(stored?.probe?.codec).not.toBeNull()
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '取り込みを終えた video は 2 回目で skip する',
    async () => {
      const asset = await seedAsset(repo, storage, {
        kind: 'video',
        ext: 'mp4',
        mimeType: 'video/mp4',
        body: videoBytes,
        probe: renderWrittenProbe,
        origin: renderedOrigin(),
      })

      await processMediaJob(deps(), { mediaAssetId: asset.id })
      const afterFirst = repo.updateCount()

      const outcome = await processMediaJob(deps(), { mediaAssetId: asset.id })

      expect(outcome).toEqual({ state: 'skipped', reason: 'already_ingested' })
      expect(repo.updateCount()).toBe(afterFirst)
    },
    FFMPEG_TIMEOUT_MS,
  )
})
