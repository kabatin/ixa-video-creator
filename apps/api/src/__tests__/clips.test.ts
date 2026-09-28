import { OpenAPIHono } from '@hono/zod-openapi'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import {
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  TimelineClipId as TimelineClipIdSchema,
  newId,
} from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  clipRoutes,
  INVALID_TRACK_MESSAGE,
  INVALID_TRIM_RANGE_MESSAGE,
  TRIM_LENGTH_MISMATCH_MESSAGE,
  TRIM_NEEDS_DURATION_MESSAGE,
  MISSING_ASSET_MESSAGE,
  NON_POSITIVE_DURATION_MESSAGE,
  UNREADABLE_TEXT_STYLE_MESSAGE,
  type ClipRoutesDeps,
} from '../routes/clips.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  aMediaAsset,
  createInMemoryTimelineClipRepository,
  type InMemoryTimelineClipRepository,
} from './in-memory-timeline-repositories.js'

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type MediaContent = {
  type: 'media'
  mediaAssetId: string
  inSec: number
  outSec: number
  volume: number
}
type TemplateContent = { type: 'text' | 'motion_graphics'; templateKey: string; params: unknown }
type ClipContent = MediaContent | TemplateContent

type ClipBody = {
  id: string
  projectId: string
  track: string
  startSec: number
  durationSec: number
  layer: number
  content: ClipContent
  opacity: number
  createdAt: string
}

const project = aProject()
const otherProject = aProject({ name: '別の Project' })
const asset = aMediaAsset()

let timelineClips: InMemoryTimelineClipRepository

const buildApp = (deps: ClipRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', clipRoutes(deps))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

let app: ReturnType<typeof buildApp>

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

/** media クリップの既定の本文。個々のテストは必要な項目だけ上書きする。 */
const mediaClipPayload = (overrides: Record<string, unknown> = {}) => ({
  track: 'VIDEO2',
  startSec: 1.5,
  durationSec: 2.5,
  content: { type: 'media', mediaAssetId: asset.id, inSec: 0, outSec: 2.5 },
  ...overrides,
})

const textClipPayload = (overrides: Record<string, unknown> = {}) => ({
  track: 'TEXT',
  startSec: 0,
  durationSec: 3,
  content: { type: 'text', templateKey: 'lower-third', params: { label: 'iXA CUP' } },
  ...overrides,
})

const motionClipPayload = (overrides: Record<string, unknown> = {}) => ({
  track: 'VFX',
  startSec: 4,
  durationSec: 1.25,
  content: { type: 'motion_graphics', templateKey: 'glitch-wipe' },
  ...overrides,
})

const createClip = async (
  projectId: string,
  payload: Record<string, unknown>,
): Promise<ClipBody> => {
  const res = await send('POST', `/projects/${projectId}/clips`, payload)
  expect(res.status).toBe(201)
  const body = await json<SuccessBody<ClipBody>>(res)
  return body.data
}

beforeEach(() => {
  timelineClips = createInMemoryTimelineClipRepository()
  app = buildApp({
    timelineClips,
    projects: createInMemoryProjectRepository([project, otherProject]),
    mediaAssets: createInMemoryMediaAssetRepository([asset]),
  })
})

describe('作成（content の 3 バリアント）', () => {
  it('media クリップを 201 で作成し、経路の projectId と既定値が入る', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    expect(created.projectId).toBe(project.id)
    expect(created.track).toBe('VIDEO2')
    expect(created.startSec).toBe(1.5)
    expect(created.durationSec).toBe(2.5)
    expect(created.layer).toBe(0)
    expect(created.opacity).toBe(1)
    expect(created.content).toEqual({
      type: 'media',
      mediaAssetId: asset.id,
      inSec: 0,
      outSec: 2.5,
      volume: 1,
    })
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('text クリップを 201 で作成し、params がそのまま載る', async () => {
    const created = await createClip(project.id, textClipPayload())

    expect(created.track).toBe('TEXT')
    expect(created.content).toEqual({
      type: 'text',
      templateKey: 'lower-third',
      params: { label: 'iXA CUP' },
    })
  })

  it('motion_graphics クリップは params 省略時に空オブジェクトになる', async () => {
    const created = await createClip(project.id, motionClipPayload())

    expect(created.content).toEqual({
      type: 'motion_graphics',
      templateKey: 'glitch-wipe',
      params: {},
    })
  })

  it('layer と opacity は明示すればその値が入る', async () => {
    const created = await createClip(project.id, textClipPayload({ layer: 2, opacity: 0.4 }))

    expect(created.layer).toBe(2)
    expect(created.opacity).toBe(0.4)
  })
})

describe('一覧', () => {
  it('3 バリアントすべてが投入順で返る', async () => {
    await createClip(project.id, mediaClipPayload())
    await createClip(project.id, textClipPayload())
    await createClip(project.id, motionClipPayload())

    const res = await send('GET', `/projects/${project.id}/clips`)
    expect(res.status).toBe(200)
    const listBody = await json<ListBody<ClipBody>>(res)
    expect(listBody.data.map((clip) => clip.content.type)).toEqual([
      'media',
      'text',
      'motion_graphics',
    ])
    expect(listBody.meta.total).toBe(3)
  })

  it('?track= で絞り込める', async () => {
    await createClip(project.id, mediaClipPayload())
    await createClip(project.id, textClipPayload())

    const res = await send('GET', `/projects/${project.id}/clips?track=TEXT`)
    expect(res.status).toBe(200)
    const listBody = await json<ListBody<ClipBody>>(res)
    expect(listBody.data.map((clip) => clip.track)).toEqual(['TEXT'])
    expect(listBody.meta.total).toBe(1)
  })

  it('他 Project のクリップは混ざらない', async () => {
    await createClip(project.id, textClipPayload({ startSec: 0 }))
    await createClip(otherProject.id, textClipPayload({ startSec: 9 }))

    const res = await send('GET', `/projects/${project.id}/clips`)
    const listBody = await json<ListBody<ClipBody>>(res)
    expect(listBody.data.map((clip) => clip.startSec)).toEqual([0])
  })
})

describe('VIDEO1 は TimelineClip を持たない（ADR-0002）', () => {
  /**
   * VIDEO1 は Shot の投影なので `TimelineTrack` の enum に存在しない。
   * 「なぜ弾かれるか」が呼び出し側に伝わることまで確認する。
   */
  it('作成で track=VIDEO1 は 422 になり、理由が fields.track に載る', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, {
      ...mediaClipPayload(),
      track: 'VIDEO1',
    })

    expect(res.status).toBe(422)
    const errorBody = await json<ErrorBody>(res)
    expect(errorBody.fields?.track).toEqual([INVALID_TRACK_MESSAGE])
    expect(INVALID_TRACK_MESSAGE).toContain('VIDEO1')
    expect(timelineClips.snapshot()).toEqual([])
  })

  it('更新で track=VIDEO1 へ移そうとしても 422 になる', async () => {
    const created = await createClip(project.id, textClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, { track: 'VIDEO1' })
    expect(res.status).toBe(422)
    const errorBody = await json<ErrorBody>(res)
    expect(errorBody.fields?.track).toEqual([INVALID_TRACK_MESSAGE])
  })

  /**
   * 未知の track を黙って無視すると全件が返り、呼び出し側は
   * 「VIDEO1 のクリップがこれだけある」と読み違える。絞り込みの誤りは 422 で返す。
   */
  it('?track=VIDEO1 は全件を返さず 422 になる', async () => {
    await createClip(project.id, textClipPayload())

    const res = await send('GET', `/projects/${project.id}/clips?track=VIDEO1`)
    expect(res.status).toBe(422)
    const errorBody = await json<ErrorBody>(res)
    expect(errorBody.fields?.track).toEqual([INVALID_TRACK_MESSAGE])
  })
})

describe('更新（content の 3 バリアント）', () => {
  it('media クリップの尺だけを更新しても content は残る', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, { durationSec: 4 })
    expect(res.status).toBe(200)
    const body = await json<SuccessBody<ClipBody>>(res)
    expect(body.data.durationSec).toBe(4)
    expect(body.data.content).toEqual(created.content)
    expect(body.data.projectId).toBe(project.id)
  })

  it('text クリップの content を差し替えられる', async () => {
    const created = await createClip(project.id, textClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, {
      content: { type: 'text', templateKey: 'caption', params: { label: '決勝戦' } },
    })
    expect(res.status).toBe(200)
    const body = await json<SuccessBody<ClipBody>>(res)
    expect(body.data.content).toEqual({
      type: 'text',
      templateKey: 'caption',
      params: { label: '決勝戦' },
    })
  })

  it('motion_graphics の layer と opacity を更新できる', async () => {
    const created = await createClip(project.id, motionClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, { layer: 3, opacity: 0 })
    expect(res.status).toBe(200)
    const body = await json<SuccessBody<ClipBody>>(res)
    expect(body.data.layer).toBe(3)
    expect(body.data.opacity).toBe(0)
    expect(body.data.content).toEqual(created.content)
  })

  /**
   * media から text へ変えたクリップに素材の実在確認は要らない。
   * 差し替えは部分マージではなくバリアントごとなので、古い mediaAssetId は残らない。
   */
  it('media から text へ差し替えると mediaAssetId は消える', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, {
      track: 'TEXT',
      content: { type: 'text', templateKey: 'caption' },
    })
    expect(res.status).toBe(200)
    const body = await json<SuccessBody<ClipBody>>(res)
    expect(body.data.content).toEqual({ type: 'text', templateKey: 'caption', params: {} })
    expect(body.data.track).toBe('TEXT')
  })
})

describe('削除', () => {
  it('DELETE は 204 を返し、本文が無く、一覧から消える', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('DELETE', `/clips/${created.id}`)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    const list = await send('GET', `/projects/${project.id}/clips`)
    const listBody = await json<ListBody<ClipBody>>(list)
    expect(listBody.data).toEqual([])
  })
})

describe('存在しない対象', () => {
  it('存在しない Project の一覧・作成は 404', async () => {
    const ghost = newId(ProjectIdSchema)

    expect((await send('GET', `/projects/${ghost}/clips`)).status).toBe(404)
    expect((await send('POST', `/projects/${ghost}/clips`, mediaClipPayload())).status).toBe(404)
  })

  it('存在しない Project への作成は保存されない', async () => {
    const ghost = newId(ProjectIdSchema)

    await send('POST', `/projects/${ghost}/clips`, mediaClipPayload())
    expect(timelineClips.snapshot()).toEqual([])
  })

  it('存在しないクリップの更新・削除は 404', async () => {
    const ghost = newId(TimelineClipIdSchema)

    expect((await send('PATCH', `/clips/${ghost}`, { durationSec: 1 })).status).toBe(404)
    expect((await send('DELETE', `/clips/${ghost}`)).status).toBe(404)
  })
})

describe('入力の検証', () => {
  it('存在しない MediaAsset を指す media クリップは 422', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, {
      ...mediaClipPayload(),
      content: { type: 'media', mediaAssetId: newId(MediaAssetIdSchema), inSec: 0, outSec: 2.5 },
    })

    expect(res.status).toBe(422)
    const errorBody = await json<ErrorBody>(res)
    expect(errorBody.fields?.['content.mediaAssetId']).toEqual([MISSING_ASSET_MESSAGE])
    expect(timelineClips.snapshot()).toEqual([])
  })

  it('更新で存在しない MediaAsset へ差し替えても 422 で、元の content が残る', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, {
      content: { type: 'media', mediaAssetId: newId(MediaAssetIdSchema), inSec: 0, outSec: 2.5 },
    })
    expect(res.status).toBe(422)

    const list = await send('GET', `/projects/${project.id}/clips`)
    const listBody = await json<ListBody<ClipBody>>(list)
    expect(listBody.data[0]?.content).toEqual(created.content)
  })

  it('inSec が outSec と同じ / より大きい media クリップは 422', async () => {
    const equal = await send('POST', `/projects/${project.id}/clips`, {
      ...mediaClipPayload(),
      content: { type: 'media', mediaAssetId: asset.id, inSec: 2, outSec: 2 },
    })
    expect(equal.status).toBe(422)
    expect((await json<ErrorBody>(equal)).fields?.['content.inSec']).toEqual([
      INVALID_TRIM_RANGE_MESSAGE,
    ])

    const reversed = await send('POST', `/projects/${project.id}/clips`, {
      ...mediaClipPayload(),
      content: { type: 'media', mediaAssetId: asset.id, inSec: 3, outSec: 1 },
    })
    expect(reversed.status).toBe(422)
  })

  it('更新で inSec >= outSec にしようとしても 422', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, {
      content: { type: 'media', mediaAssetId: asset.id, inSec: 5, outSec: 5 },
    })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.['content.inSec']).toEqual([
      INVALID_TRIM_RANGE_MESSAGE,
    ])
  })

  it('durationSec が 0 は 422（尺ゼロのクリップは作らせない）', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`,
      textClipPayload({ durationSec: 0 }))

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.durationSec).toEqual([
      NON_POSITIVE_DURATION_MESSAGE,
    ])
  })

  it('durationSec が負なら 422（Seconds は非負のみ）', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`,
      textClipPayload({ durationSec: -1 }))

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.durationSec).toBeDefined()
  })

  it('更新で durationSec を 0 にしようとしても 422', async () => {
    const created = await createClip(project.id, textClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, { durationSec: 0 })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.durationSec).toEqual([
      NON_POSITIVE_DURATION_MESSAGE,
    ])
  })

  it('durationSec は float を受け付ける（秒はフレームではない）', async () => {
    const created = await createClip(project.id, textClipPayload({ durationSec: 0.0333 }))
    expect(created.durationSec).toBe(0.0333)
  })

  it('content の type が未知なら 422', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, {
      ...textClipPayload(),
      content: { type: 'sticker', templateKey: 'x' },
    })
    expect(res.status).toBe(422)
  })
})

describe('トリムの長さと配置尺の整合（Architect 追加）', () => {
  /**
   * レンダラは outSec を読まず、inSec から durationSec ぶんだけ再生する
   * （packages/render/src/compositions/Timeline.tsx）。食い違ったまま保存できると、
   * 画面で指定した終点が黙って無視される。速度変更は実装していないので正しい解釈が無い。
   */
  it('outSec − inSec と durationSec が食い違う media クリップは 422', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, {
      ...mediaClipPayload(),
      durationSec: 2.5,
      content: { type: 'media', mediaAssetId: asset.id, inSec: 0, outSec: 1 },
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.durationSec).toEqual([TRIM_LENGTH_MISMATCH_MESSAGE])
    expect(timelineClips.snapshot()).toEqual([])
  })

  it('一致していれば通る', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, {
      ...mediaClipPayload(),
      durationSec: 1.25,
      content: { type: 'media', mediaAssetId: asset.id, inSec: 0.5, outSec: 1.75 },
    })

    expect(res.status).toBe(201)
  })

  it('範囲が壊れているときは、そちらのメッセージだけを返す（直す順番が分かるように）', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, {
      ...mediaClipPayload(),
      durationSec: 2.5,
      content: { type: 'media', mediaAssetId: asset.id, inSec: 2, outSec: 1 },
    })

    expect(res.status).toBe(422)
    const body = await json<ErrorBody>(res)
    expect(body.fields?.['content.inSec']).toEqual([INVALID_TRIM_RANGE_MESSAGE])
    expect(body.fields?.durationSec).toBeUndefined()
  })

  it('text クリップは長さの整合を求めない（トリムが無いため）', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, textClipPayload())
    expect(res.status).toBe(201)
  })

  it('更新でも食い違いを弾く', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, {
      durationSec: 2.5,
      content: { type: 'media', mediaAssetId: asset.id, inSec: 0, outSec: 9 },
    })

    expect(res.status).toBe(422)
  })

  it('トリムだけ送る部分更新は 422（検証が素通りしないようにする）', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, {
      content: { type: 'media', mediaAssetId: asset.id, inSec: 0, outSec: 9 },
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.durationSec).toEqual([TRIM_NEEDS_DURATION_MESSAGE])
  })

  it('トリムと尺を揃えて送る部分更新は通る', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    const res = await send('PATCH', `/clips/${created.id}`, {
      durationSec: 3,
      content: { type: 'media', mediaAssetId: asset.id, inSec: 1, outSec: 4 },
    })

    expect(res.status).toBe(200)
  })

  it('トリム以外だけの部分更新は、尺を送らなくても通る', async () => {
    const created = await createClip(project.id, mediaClipPayload())

    expect((await send('PATCH', `/clips/${created.id}`, { opacity: 0.5 })).status).toBe(200)
  })
})

/** テロップの見た目（ADR-0028）。読めない見た目は保存させない（描く側は既定値に落とすだけなので気付けない）。 */
describe('テロップの見た目の検査', () => {
  const styled = (style: unknown) =>
    textClipPayload({ content: { type: 'text', templateKey: 'plain', params: { text: '歌詞', style } } })

  it('読める見た目は保存する', async () => {
    const created = await createClip(project.id, styled({ color: '#FFD100', anchor: 'top-left' }))
    expect(created.content).toMatchObject({ params: { text: '歌詞', style: { color: '#FFD100', anchor: 'top-left' } } })
  })

  it('作成で読めない見た目は 422', async () => {
    const res = await send('POST', `/projects/${project.id}/clips`, styled({ color: 'red' }))
    expect(res.status).toBe(422)
    const body = await json<ErrorBody>(res)
    expect(body.fields?.['content.params.style']).toEqual([UNREADABLE_TEXT_STYLE_MESSAGE])
  })

  it('更新で読めない見た目は 422（元の見た目は残る）', async () => {
    const created = await createClip(project.id, styled({ color: '#FFD100' }))
    const res = await send('PATCH', `/clips/${created.id}`, {
      content: { type: 'text', templateKey: 'plain', params: { text: '歌詞', style: { size: 9 } } },
    })
    expect(res.status).toBe(422)
    expect(timelineClips.snapshot()[0]?.content).toMatchObject({ params: { style: { color: '#FFD100' } } })
  })
})
