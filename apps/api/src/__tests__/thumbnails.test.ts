import { OpenAPIHono } from '@hono/zod-openapi'
import { newId, ProjectId as ProjectIdSchema, type MediaAsset, type Project, type ThumbnailJobData } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  EMPTY_TIMELINE_MESSAGE,
  FOREIGN_IMAGE_MESSAGE,
  MISSING_IMAGE_MESSAGE,
  NOT_IMAGE_MESSAGE,
  OUTSIDE_TIMELINE_MESSAGE,
  thumbnailRoutes,
  type ThumbnailQueue,
  type ThumbnailResponse,
} from '../routes/thumbnails.js'
import { aProject } from './fixtures.js'
import { createInMemoryThumbnailRepository } from './in-memory-thumbnail-repository.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'
import { aShotWithTake, timelineDeps } from './timeline-deps.js'

/**
 * サムネイルの書き出し（ADR-0051）。実 DB / 実キューには接続しない。
 * 行には署名付き URL を書かず、タイムラインの文書はジョブの中身でだけ運ぶことを確かめる。
 */

type Ok<T> = { success: true; data: T }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

const TIME_ZONE = 'Asia/Tokyo'

const recordingQueue = (fails = false): ThumbnailQueue & { readonly enqueued: ThumbnailJobData[] } => {
  const enqueued: ThumbnailJobData[] = []
  return {
    enqueued,
    enqueue: (data) => {
      if (fails) return Promise.reject(new Error('Redis に繋がらない'))
      enqueued.push(data)
      return Promise.resolve()
    },
  }
}

const build = (
  options: { project?: Project; mediaAssets?: readonly MediaAsset[]; withTimeline?: boolean; queueFails?: boolean } = {},
) => {
  const project = options.project ?? aProject({ name: 'ぼくははると' })
  const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
  const thumbnails = createInMemoryThumbnailRepository()
  const queue = recordingQueue(options.queueFails)
  const base = timelineDeps({
    project,
    shots: options.withTimeline === false ? [] : [withTake.shot],
    takes: options.withTimeline === false ? [] : [withTake.take],
    mediaAssets: [withTake.asset, ...(options.mediaAssets ?? [])],
  })
  const app = new OpenAPIHono()
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', thumbnailRoutes({ ...base, thumbnails, thumbnailQueue: queue, timeZone: TIME_ZONE }))
  const post = (spec: unknown, projectId: string = project.id) =>
    app.request(`/projects/${projectId}/thumbnails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec }),
    })
  return { app, project, thumbnails, queue, post }
}

const frameSpec = (atSec: number) => ({ background: { kind: 'timeline_frame', atSec }, title: '新曲' })
const imageSpec = (asset: MediaAsset) => ({ background: { kind: 'image', mediaAssetId: asset.id }, title: '新曲' })
const anImage = (project: Project, overrides: Partial<MediaAsset> = {}) =>
  aMediaAsset({ kind: 'image', mimeType: 'image/png', storageKey: 'media/ws/key-art.png', projectId: project.id, ...overrides })

const fieldOf = async (res: Response): Promise<string | undefined> => ((await res.json()) as ErrorBody).fields?.background?.[0]

describe('POST /projects/{projectId}/thumbnails', () => {
  it('タイムラインのコマなら、書き出しと同じ文書をジョブの中身で渡し、行には秒だけを書く', async () => {
    const f = build()

    const res = await f.post({ ...frameSpec(1.5), subtitle: 'MV 公開' })

    expect(res.status).toBe(202)
    const { thumbnailId } = ((await res.json()) as Ok<{ thumbnailId: string }>).data
    const [row] = f.thumbnails.snapshot()
    expect(row).toMatchObject({ id: thumbnailId, status: 'queued', spec: { background: { kind: 'timeline_frame', atSec: 1.5 } } })
    expect(row?.fileName).toMatch(/^ぼくははると サムネ \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2} [0-9a-z]{6}\.jpg$/)
    expect(row?.fileName.endsWith(`${thumbnailId.slice(-6).toLowerCase()}.jpg`)).toBe(true)
    expect(JSON.stringify(row)).not.toMatch(/https?:\/\//)
    expect(f.queue.enqueued).toHaveLength(1)
    expect(f.queue.enqueued[0]?.thumbnailId).toBe(thumbnailId)
    expect(f.queue.enqueued[0]?.timeline?.video1).toHaveLength(1)
    expect(f.queue.enqueued[0]?.timeline?.durationSec).toBe(4)
  })

  it('同じ秒に 2 枚頼んでも、名前は別になる（フォルダで 2 枚目が飛ばされない）', async () => {
    const f = build()
    await f.post(frameSpec(1))
    await f.post(frameSpec(2))
    const names = f.thumbnails.snapshot().map((row) => row.fileName)
    expect(new Set(names).size).toBe(2)
  })

  it('画像の背景なら文書を載せない（worker が描く直前に URL を発行する）', async () => {
    const project = aProject()
    const image = anImage(project)
    const f = build({ project, mediaAssets: [image] })

    const res = await f.post(imageSpec(image))

    expect(res.status).toBe(202)
    expect(f.queue.enqueued[0]?.timeline).toBeNull()
  })

  it('背景の画像が無い・ほかの作品の・画像でない素材は 422。行も作らず積まない', async () => {
    const project = aProject()
    const foreign = anImage(aProject())
    const video = aMediaAsset({ kind: 'video', projectId: project.id })
    const f = build({ project, mediaAssets: [foreign, video] })

    const missing = await f.post(imageSpec(anImage(project)))
    expect(missing.status).toBe(422)
    expect(await fieldOf(missing)).toBe(MISSING_IMAGE_MESSAGE)
    expect(await fieldOf(await f.post(imageSpec(foreign)))).toBe(FOREIGN_IMAGE_MESSAGE)
    expect(await fieldOf(await f.post(imageSpec(video)))).toBe(NOT_IMAGE_MESSAGE)
    expect(f.thumbnails.snapshot()).toEqual([])
    expect(f.queue.enqueued).toEqual([])
  })

  it('タイムラインが空、または長さを超えた位置は 422', async () => {
    const empty = build({ withTimeline: false })
    expect(await fieldOf(await empty.post(frameSpec(0)))).toBe(EMPTY_TIMELINE_MESSAGE)

    const f = build()
    expect(await fieldOf(await f.post(frameSpec(4)))).toBe(OUTSIDE_TIMELINE_MESSAGE)
    expect((await f.post(frameSpec(3.99))).status).toBe(202)
  })

  it('仕様の上限を破る値は 422（題名 41 字・拡大 2.5 倍）', async () => {
    const f = build()
    expect((await f.post({ ...frameSpec(1), title: 'あ'.repeat(41) })).status).toBe(422)
    expect((await f.post({ ...frameSpec(1), zoom: 2.5 })).status).toBe(422)
    expect(f.thumbnails.snapshot()).toEqual([])
  })

  it('無いプロジェクトは 404', async () => {
    const f = build()
    expect((await f.post(frameSpec(1), newId(ProjectIdSchema))).status).toBe(404)
  })

  it('キューへ入れられなければ、行を失敗にしてから 500（「描いています」のまま残さない）', async () => {
    const f = build({ queueFails: true })

    expect((await f.post(frameSpec(1))).status).toBe(500)
    expect(f.thumbnails.snapshot()[0]).toMatchObject({ status: 'failed' })
    expect(f.thumbnails.snapshot()[0]?.error).toMatch(/もう一度押してください/)
  })
})

describe('GET /thumbnails/{id} と /projects/{projectId}/thumbnails', () => {
  it('1 件の状態を返し、一覧は新しい順', async () => {
    const f = build()
    const first = ((await (await f.post(frameSpec(1))).json()) as Ok<{ thumbnailId: string }>).data.thumbnailId
    const second = ((await (await f.post(frameSpec(2))).json()) as Ok<{ thumbnailId: string }>).data.thumbnailId

    const one = await f.app.request(`/thumbnails/${first}`)
    expect(one.status).toBe(200)
    const body = ((await one.json()) as Ok<ThumbnailResponse>).data
    expect(body).toMatchObject({ id: first, status: 'queued', outputAssetId: null, error: null, finishedAt: null })
    expect(typeof body.createdAt).toBe('string')

    const list = ((await (await f.app.request(`/projects/${f.project.id}/thumbnails`)).json()) as Ok<ThumbnailResponse[]>).data
    expect(list.map((item) => item.id)).toEqual([second, first])
  })

  it('無いサムネイル・無いプロジェクトは 404', async () => {
    const f = build()
    expect((await f.app.request(`/thumbnails/${newId(ProjectIdSchema)}`)).status).toBe(404)
    expect((await f.app.request(`/projects/${newId(ProjectIdSchema)}/thumbnails`)).status).toBe(404)
  })
})
