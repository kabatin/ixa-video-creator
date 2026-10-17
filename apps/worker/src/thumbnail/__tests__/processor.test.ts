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
import { THUMBNAIL_RENDER_FAILED_MESSAGE, THUMBNAIL_TOO_BIG_MESSAGE, type RenderThumbnailStillInput } from '@ixa/render'
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
import { THUMBNAIL_FAILED_MESSAGE } from '../failure.js'
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
  /** 実物と同じく、終わった行は書き換えずにそのまま返す。 */
  const save = (patch: Partial<Thumbnail>): Promise<Thumbnail> => {
    if (row.status === 'done' || row.status === 'failed') return Promise.resolve(row)
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
  /** ほかの手（打ち切りの受け口など）が行を終わらせたことにする。 */
  const finishElsewhere = (patch: Partial<Thumbnail>) => {
    row = { ...row, ...patch }
  }
  return { repo, current: () => row, finishElsewhere }
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
type RenderOptions = { readonly fail?: boolean; readonly failWith?: Error; readonly onRender?: () => void }

const fakeRenderStill = (options: RenderOptions = {}) => {
  const calls: RenderThumbnailStillInput[] = []
  const renderStill = async (input: RenderThumbnailStillInput) => {
    calls.push(input)
    options.onRender?.()
    if (options.failWith !== undefined) throw options.failWith
    if (options.fail === true) throw new Error(THUMBNAIL_RENDER_FAILED_MESSAGE, { cause: new Error(`Failed to load ${SIGNED} (quality 90)`) })
    const path = join(input.outputDir, `still-${String(calls.length)}.jpg`)
    await writeFile(path, JPEG)
    return { path, bytes: JPEG.byteLength, jpegQuality: 90 }
  }
  return { renderStill, calls }
}

const setup = async (thumbnail: Thumbnail, options: RenderOptions = {}) => {
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
    logger: options.fail === true || options.failWith !== undefined ? logger : silentLogger,
  } satisfies ThumbnailProcessorDeps
  return { deps, thumbnails, render, image, mediaAssets, logged, storage }
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

  it('同じ絵になる 2 枚の書き出しでも、それぞれ自分の作品の素材を持つ（別の書き出しの素材を指さない）', async () => {
    const first = await setup(aThumbnail())
    await processThumbnailJob(first.deps, { thumbnailId: first.thumbnails.current().id, timeline: DOC })
    const again = aThumbnail()
    const repo = fakeThumbnails(again)

    await processThumbnailJob({ ...first.deps, thumbnails: repo.repo }, { thumbnailId: again.id, timeline: DOC })

    const firstAssetId = first.thumbnails.current().outputAssetId
    const secondAssetId = repo.current().outputAssetId
    expect(secondAssetId).not.toBeNull()
    expect(secondAssetId).not.toBe(firstAssetId)
    const second = secondAssetId === null ? null : await first.mediaAssets.findById(secondAssetId)
    expect(second).toMatchObject({ projectId: project.id, origin: { type: 'thumbnail', thumbnailId: again.id } })
  })

  it('同じ書き出しを積み直したら、前に作った素材を使う（二重に作らない）', async () => {
    const thumbnail = aThumbnail()
    const f = await setup(thumbnail)
    await processThumbnailJob(f.deps, { thumbnailId: thumbnail.id, timeline: DOC })
    const assetId = f.thumbnails.current().outputAssetId
    // 素材を作った後に落ちて、行は描いている途中のまま積み直された。
    const retried = fakeThumbnails({ ...thumbnail, status: 'rendering' })

    await processThumbnailJob({ ...f.deps, thumbnails: retried.repo }, { thumbnailId: thumbnail.id, timeline: DOC })

    expect(retried.current().outputAssetId).toBe(assetId)
    expect(f.deps.mediaQueue.enqueued()).toHaveLength(1)
  })

  it('JPEG にこの書き出しの ID を書き込み、絵の頭（SOI）は保つ', async () => {
    const f = await setup(aThumbnail())
    await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: DOC })
    const assetId = f.thumbnails.current().outputAssetId
    const asset = assetId === null ? null : await f.mediaAssets.findById(assetId)
    const stored = Buffer.from(asset === null ? [] : await f.storage.get(asset.storageKey))
    expect([...stored.subarray(0, 2)]).toEqual([0xff, 0xd8])
    expect(stored.includes(`ixa-thumbnail:${f.thumbnails.current().id}`)).toBe(true)
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
    expect(f.thumbnails.current().error).not.toContain('X-Amz-Signature')
    expect(f.logged.join('\n')).not.toContain('X-Amz-Signature')
    expect(f.logged.join('\n')).toContain('(URL)')
  })

  it('画面に出る文は決まった日本語だけ。Chrome の英語や画質の値は重ねず、ログにだけ残す', async () => {
    const f = await setup(aThumbnail(), { fail: true })
    await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: DOC })
    expect(f.thumbnails.current().error).toBe(THUMBNAIL_FAILED_MESSAGE)
    expect(f.logged.join('\n')).toContain('Failed to load')
  })

  it('思いがけない例外（英語の文）でも、画面に出るのは決まった日本語', async () => {
    const f = await setup(aThumbnail(), { failWith: new TypeError('Cannot read properties of undefined') })
    await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: DOC })
    expect(f.thumbnails.current().error).toBe(THUMBNAIL_FAILED_MESSAGE)
  })

  it('2 MB に収まらなかったときは、その理由の日本語を出す', async () => {
    const f = await setup(aThumbnail(), { failWith: new Error(THUMBNAIL_TOO_BIG_MESSAGE, { cause: new Error('2.10 MB') }) })
    await processThumbnailJob(f.deps, { thumbnailId: f.thumbnails.current().id, timeline: DOC })
    expect(f.thumbnails.current().error).toBe(THUMBNAIL_TOO_BIG_MESSAGE)
  })

  it('描いている間にほかの手が失敗にしていたら、done で上書きせずに手を引く', async () => {
    const thumbnail = aThumbnail()
    const holder: { finish?: () => void } = {}
    const f = await setup(thumbnail, { onRender: () => holder.finish?.() })
    holder.finish = () => {
      f.thumbnails.finishElsewhere({ status: 'failed', error: '打ち切られました', finishedAt: new Date() })
    }
    expect(await processThumbnailJob(f.deps, { thumbnailId: thumbnail.id, timeline: DOC })).toEqual({ state: 'skipped' })
    expect(f.thumbnails.current().status).toBe('failed')
  })
})

describe('withoutUrls', () => {
  it('http(s) も file も抜き、ほかの文字は残す', () => {
    expect(withoutUrls(`読めません: ${SIGNED} (404)`)).toBe('読めません: (URL) (404)')
    expect(withoutUrls('file:///tmp/a.jpg と http://x/y')).toBe('(URL) と (URL)')
    expect(withoutUrls('URL なし')).toBe('URL なし')
  })
})
