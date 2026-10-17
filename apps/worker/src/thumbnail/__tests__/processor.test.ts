import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ThumbnailRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  ThumbnailId as ThumbnailIdSchema,
  ThumbnailSpec,
  newId,
  thumbnailViolation,
  type Thumbnail,
  type ThumbnailSpecInput,
  type TimelineDocument,
} from '@ixa/domain'
import type { RenderThumbnailStillInput } from '@ixa/render'
import { createMemoryStorage, mediaKey } from '@ixa/storage'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aProject,
  createRecordingMediaQueue,
  inMemoryMediaAssets,
  inMemoryProjects,
  silentLogger,
} from '../../generation/__tests__/doubles.js'
import { processThumbnailJob, type ThumbnailProcessorDeps } from '../processor.js'
import { withoutUrls } from '../redact.js'

/**
 * サムネイルの書き出し（ADR-0051）。Chrome は起こさず、描く関数を差し替えて段取りだけを確かめる。
 */

const project = aProject()
const SIGNED = 'https://minio.local/bucket/key.png?X-Amz-Signature=deadbeef'
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex')

const DOC: TimelineDocument = {
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 10,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-thumbnail-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 書くたびに状態と中身の食い違いを確かめる偽のリポジトリ（実物と同じ規則）。 */
const fakeThumbnails = (seed: Thumbnail) => {
  let row = seed
  const save = (patch: Partial<Thumbnail>): Promise<Thumbnail> => {
    const next = { ...row, ...patch }
    const violation = thumbnailViolation(next)
    if (violation !== null) return Promise.reject(new Error(violation))
    row = next
    return Promise.resolve(row)
  }
  const repo: Pick<ThumbnailRepository, 'findById' | 'markRendering' | 'markDone' | 'markFailed'> = {
    findById: (id) => Promise.resolve(id === row.id ? row : null),
    markRendering: () => save({ status: 'rendering' }),
    markDone: (_id, outputAssetId) => save({ status: 'done', outputAssetId, finishedAt: new Date() }),
    markFailed: (_id, error) => save({ status: 'failed', error, finishedAt: new Date() }),
  }
  return { repo, current: () => row }
}

const aThumbnail = (spec: Partial<ThumbnailSpecInput> = {}, patch: Partial<Thumbnail> = {}): Thumbnail => ({
  id: newId(ThumbnailIdSchema),
  projectId: project.id,
  spec: ThumbnailSpec.parse({ background: { kind: 'timeline_frame', atSec: 3 }, title: '新曲', ...spec }),
  status: 'queued',
  outputAssetId: null,
  fileName: 'x サムネ 2026-10-17 10.00.00.jpg',
  error: null,
  createdAt: new Date(),
  finishedAt: null,
  ...patch,
})

/** 背景を覚え、JPEG を書く偽の描き手。`fail` なら署名付き URL 入りの文で落ちる（Chrome がそう言うことがある）。 */
const fakeRenderStill = (options: { fail?: boolean } = {}) => {
  const calls: RenderThumbnailStillInput[] = []
  const renderStill = async (input: RenderThumbnailStillInput) => {
    calls.push(input)
    if (options.fail === true) throw new Error(`Failed to load ${SIGNED}`)
    const path = join(input.outputDir, `still-${String(calls.length)}.jpg`)
    await writeFile(path, JPEG)
    return { path, bytes: JPEG.byteLength, jpegQuality: 90 }
  }
  return { renderStill, calls }
}

const setup = async (thumbnail: Thumbnail, options: { fail?: boolean } = {}) => {
  const storage = createMemoryStorage()
  const mediaAssets = inMemoryMediaAssets()
  const image = await mediaAssets.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'image',
    storageKey: mediaKey(project.workspaceId, newId(MediaAssetIdSchema), 'png'),
    mimeType: 'image/png',
    bytes: 1,
    checksumSha256: 'c'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'tester' },
  })
  const thumbnails = fakeThumbnails(thumbnail)
  const render = fakeRenderStill(options)
  const logged: string[] = []
  const logger = pino({ level: 'info' }, { write: (line: string) => logged.push(line) })
  const deps = {
    thumbnails: thumbnails.repo,
    projects: inMemoryProjects([project]),
    mediaAssets,
    storage: { put: (key, body, options) => storage.put(key, body, options), signedGetUrl: () => Promise.resolve(SIGNED) },
    renderStill: render.renderStill,
    outputDir: dir,
    mediaQueue: createRecordingMediaQueue(),
    logger: options.fail === true ? logger : silentLogger,
  } satisfies ThumbnailProcessorDeps
  return { deps, thumbnails, render, image, mediaAssets, logged }
}

describe('サムネイルのジョブ', () => {
  it('タイムラインのコマなら、届いた文書で描き、JPEG を素材にして終える', async () => {
    const f = await setup(aThumbnail())

    expect(await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: DOC })).toEqual({
      state: 'succeeded',
    })

    expect(f.render.calls[0]?.props.source).toEqual({ kind: 'timeline_frame', doc: DOC })
    const done = f.thumbnails.current()
    expect(done.status).toBe('done')
    const asset = done.outputAssetId === null ? null : await f.mediaAssets.findById(done.outputAssetId)
    expect(asset).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', origin: { type: 'thumbnail', thumbnailId: done.id } })
    expect(asset?.storageKey.endsWith('.jpg')).toBe(true)
    expect(f.deps.mediaQueue.enqueued()).toEqual([done.outputAssetId])
    // 手元の JPEG は片付ける。
    await expect(access(join(dir, 'still-1.jpg'))).rejects.toThrow()
  })

  it('画像の背景は、描く直前に発行した URL で描く', async () => {
    const f = await setup(aThumbnail())
    const target = aThumbnail({ background: { kind: 'image', mediaAssetId: f.image.id } })
    const deps = { ...f.deps, thumbnails: fakeThumbnails(target).repo }

    expect(await processThumbnailJob(deps, { thumbnailId: target.id, timeline: null })).toEqual({ state: 'succeeded' })
    expect(f.render.calls[0]?.props.source).toEqual({ kind: 'image', url: SIGNED })
  })

  it('タイムラインの文書が届いていなければ失敗にする', async () => {
    const f = await setup(aThumbnail())

    expect(await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: null })).toEqual({
      state: 'failed',
    })
    expect(f.thumbnails.current().error).toMatch(/タイムライン/)
    expect(f.render.calls).toEqual([])
  })

  it('背景の画像が無い・画像でなければ失敗にする', async () => {
    const missing = await setup(aThumbnail({ background: { kind: 'image', mediaAssetId: newId(MediaAssetIdSchema) } }))
    expect(
      await processThumbnailJob(missing.deps, { thumbnailId: missing.thumbnails.current().id, timeline: null }),
    ).toEqual({ state: 'failed' })
    expect(missing.thumbnails.current().error).toMatch(/見つかりません/)

    const video = await setup(aThumbnail())
    const clip = await video.mediaAssets.create({
      workspaceId: project.workspaceId,
      projectId: project.id,
      kind: 'video',
      storageKey: mediaKey(project.workspaceId, newId(MediaAssetIdSchema), 'mp4'),
      mimeType: 'video/mp4',
      bytes: 1,
      checksumSha256: 'd'.repeat(64),
      origin: { type: 'upload', uploadedBy: 'tester' },
    })
    const target = aThumbnail({ background: { kind: 'image', mediaAssetId: clip.id } })
    const repo = fakeThumbnails(target)
    expect(await processThumbnailJob({ ...video.deps, thumbnails: repo.repo }, { thumbnailId: target.id, timeline: null })).toEqual({
      state: 'failed',
    })
    expect(repo.current().error).toMatch(/画像ではありません/)
  })

  it('中身が同じ JPEG が既にあれば、それを指す（素材を二重に作らない）', async () => {
    const first = await setup(aThumbnail())
    await processThumbnailJob(first.deps, { thumbnailId: first.thumbnails.current().id, timeline: DOC })
    const again = aThumbnail()
    const repo = fakeThumbnails(again)

    await processThumbnailJob({ ...first.deps, thumbnails: repo.repo }, { thumbnailId: again.id, timeline: DOC })

    expect(repo.current().outputAssetId).toBe(first.thumbnails.current().outputAssetId)
    expect(first.deps.mediaQueue.enqueued()).toHaveLength(1)
  })

  it('終わった行は描き直さない', async () => {
    const f = await setup(aThumbnail({}, { status: 'failed', error: '前に失敗', finishedAt: new Date() }))

    expect(await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: DOC })).toEqual({
      state: 'skipped',
    })
    expect(f.render.calls).toEqual([])
  })

  it('署名付き URL を含む失敗の文は、URL を抜いてから記録とログに残す', async () => {
    const f = await setup(aThumbnail(), { fail: true })

    expect(await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: DOC })).toEqual({
      state: 'failed',
    })
    expect(f.thumbnails.current().error).toMatch(/書き出せませんでした/)
    expect(f.thumbnails.current().error).not.toContain('X-Amz-Signature')
    expect(f.logged.join('\n')).not.toContain('X-Amz-Signature')
    expect(f.logged.join('\n')).toContain('(URL)')
  })
})

describe('withoutUrls', () => {
  it('http(s) も file も抜き、ほかの文字は残す', () => {
    expect(withoutUrls(`読めません: ${SIGNED} (404)`)).toBe('読めません: (URL) (404)')
    expect(withoutUrls('file:///tmp/a.jpg と http://x/y')).toBe('(URL) と (URL)')
    expect(withoutUrls('URL なし')).toBe('URL なし')
  })
})
