import { OpenAPIHono } from '@hono/zod-openapi'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import type { TimelineClip, TimelineClipId } from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { clipSpanRoutes } from '../routes/clip-spans.js'
import { clipRoutes } from '../routes/clips.js'
import { editBatchRoutes, type EditBatchSummaryResponse, type UndoEditBatchResponse } from '../routes/edit-batches.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryEditTransaction } from './in-memory-edit-transaction.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  aMediaAsset,
  createInMemoryTimelineClipRepository,
  type InMemoryTimelineClipRepository,
} from './in-memory-timeline-repositories.js'

/**
 * クリップ 1 件ずつの作る・直す・消すを取り消す（制作者 2026-10-19「『この効果音を消す』を押して消したけど、
 * 元に戻したい時に UNDO できなかった」）。
 *
 * 守りたいのは 3 つ。
 * 1. **記録は API が書く前に作る。** 画面の呼び手に任せない（MCP や別の画面からの操作も漏れない）
 * 2. **戻すと同じ ID・同じ中身。** 消したものは論理削除を外す
 * 3. **変わらない操作・断った操作は記録しない。** 履歴が読めなくなる
 */

type Ok<T> = { success: true; data: T }

const project = aProject()
const asset = aMediaAsset({ kind: 'audio', mimeType: 'audio/wav' })

let clips: InMemoryTimelineClipRepository
let editBatches: ReturnType<typeof createInMemoryEditBatchRepository>
let app: OpenAPIHono

beforeEach(() => {
  clips = createInMemoryTimelineClipRepository()
  editBatches = createInMemoryEditBatchRepository()
  const projects = createInMemoryProjectRepository([project])
  const transaction = createInMemoryEditTransaction({ editBatches, timelineClips: clips })
  app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', clipRoutes({ timelineClips: clips, projects, mediaAssets: createInMemoryMediaAssetRepository([asset]), transaction }))
  app.route('/', clipSpanRoutes({ timelineClips: clips, projects, transaction }))
  app.route('/', editBatchRoutes({ projects, shots: unusedShots, editBatches, timelineClips: clips }))
  registerErrorHandlers(app, createLogger('silent'))
})

/** Shot の記録は出てこないので、呼ばれたら落とす。 */
const unusedShots = {
  findById: () => Promise.reject(new Error('呼ばれない')),
  update: () => Promise.reject(new Error('呼ばれない')),
  selectTake: () => Promise.reject(new Error('呼ばれない')),
  updateStatus: () => Promise.reject(new Error('呼ばれない')),
}

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const sfxPayload = {
  track: 'SFX',
  startSec: 2,
  durationSec: 0.5,
  content: { type: 'media', mediaAssetId: asset.id, inSec: 0, outSec: 0.5, volume: 0.7, fadeOutSec: 0.1 },
}
const textPayload = {
  track: 'TEXT',
  startSec: 0,
  durationSec: 3,
  content: { type: 'text', templateKey: 'plain', params: { text: 'こんにちは' } },
}

const create = async (payload: unknown): Promise<TimelineClip> => {
  const res = await send('POST', `/projects/${project.id}/clips`, payload)
  expect(res.status).toBe(201)
  const id = ((await res.json()) as Ok<{ id: TimelineClipId }>).data.id
  const stored = clips.snapshot().find((clip) => clip.id === id)
  if (stored === undefined) throw new Error('作ったクリップが無い')
  return stored
}

const history = async (): Promise<EditBatchSummaryResponse[]> => {
  const res = await app.request(`/projects/${project.id}/edit-batches`)
  return ((await res.json()) as { data: EditBatchSummaryResponse[] }).data
}

const undo = async (batchId: string): Promise<UndoEditBatchResponse> => {
  const res = await send('POST', `/projects/${project.id}/edit-batches/${batchId}/undo`)
  expect(res.status).toBe(200)
  return ((await res.json()) as Ok<UndoEditBatchResponse>).data
}

const latest = async (): Promise<EditBatchSummaryResponse> => {
  const [first] = await history()
  if (first === undefined) throw new Error('記録が無い')
  return first
}

describe('消す → 取り消す', () => {
  it('効果音を消すと記録が残り、戻すと同じ ID・同じ中身で帯に戻る', async () => {
    const sfx = await create(sfxPayload)

    expect((await send('DELETE', `/clips/${sfx.id}`)).status).toBe(204)
    expect(clips.snapshot()).toEqual([])

    const batch = await latest()
    expect(batch).toMatchObject({ kind: 'clip_edit', summary: '効果音を消す', clipCount: 1, canUndo: true })

    const result = await undo(batch.id)
    expect(result.restoredClips).toEqual([sfx.id])
    expect(result.failedClips).toEqual([])
    expect(clips.snapshot()).toEqual([sfx])
  })

  it('もう一度戻そうとしても二度は戻さない（409）', async () => {
    const sfx = await create(sfxPayload)
    await send('DELETE', `/clips/${sfx.id}`)
    const batch = await latest()
    await undo(batch.id)
    expect((await send('POST', `/projects/${project.id}/edit-batches/${batch.id}/undo`)).status).toBe(409)
  })
})

describe('置く → 取り消す', () => {
  it('置いたテロップは、戻すと帯から消える', async () => {
    const text = await create(textPayload)
    const batch = await latest()
    expect(batch.summary).toBe('テロップを置く')

    const result = await undo(batch.id)
    expect(result.restoredClips).toEqual([text.id])
    expect(clips.snapshot()).toEqual([])
  })

  it('置いた後で消されていたら、理由つきで戻せなかったと返す', async () => {
    const text = await create(textPayload)
    const placed = await latest()
    await send('DELETE', `/clips/${text.id}`)

    const result = await undo(placed.id)
    expect(result.restoredClips).toEqual([])
    expect(result.failedClips).toHaveLength(1)
    expect(result.failedClips[0]?.clipId).toBe(text.id)
  })

  it('断った作成（尺 0）は記録しない', async () => {
    expect((await send('POST', `/projects/${project.id}/clips`, { ...textPayload, durationSec: 0 })).status).toBe(422)
    expect(await history()).toEqual([])
  })
})

describe('直す → 取り消す', () => {
  it('動かしたテロップは「テロップを動かす」で、戻すと元の位置・中身に戻る', async () => {
    const text = await create(textPayload)

    const res = await send('PATCH', `/clips/${text.id}`, { startSec: 5, durationSec: 2 })
    expect(res.status).toBe(200)
    const batch = await latest()
    expect(batch.summary).toBe('テロップを動かす')

    await undo(batch.id)
    expect(clips.snapshot()).toEqual([text])
  })

  it('文字を直したら「テロップを直す」で、戻すと元の文字に戻る', async () => {
    const text = await create(textPayload)
    await send('PATCH', `/clips/${text.id}`, { content: { type: 'text', templateKey: 'plain', params: { text: 'さようなら' } } })
    const batch = await latest()
    expect(batch.summary).toBe('テロップを直す')

    await undo(batch.id)
    expect(clips.snapshot()).toEqual([text])
  })

  it('戻すのは変えた欄だけ。記録の後に別の欄を直していたら、それは残る', async () => {
    const sfx = await create(sfxPayload)
    await send('PATCH', `/clips/${sfx.id}`, { startSec: 5 })
    const moved = await latest()
    await send('PATCH', `/clips/${sfx.id}`, { opacity: 0.5 })

    await undo(moved.id)
    expect(clips.snapshot()).toEqual([{ ...sfx, opacity: 0.5 }])
  })

  it('何も変わらない更新は記録しない', async () => {
    const text = await create(textPayload)
    const before = await history()
    expect((await send('PATCH', `/clips/${text.id}`, { startSec: 0 })).status).toBe(200)
    expect(await history()).toEqual(before)
  })

  it('直した後で消されていたら、勝手に生き返らせず理由つきで返す', async () => {
    const text = await create(textPayload)
    await send('PATCH', `/clips/${text.id}`, { startSec: 4 })
    const moved = (await history())[0]
    await send('DELETE', `/clips/${text.id}`)
    if (moved === undefined) throw new Error('記録が無い')

    const result = await undo(moved.id)
    expect(result.failedClips.map((entry) => entry.clipId)).toEqual([text.id])
    expect(clips.snapshot()).toEqual([])
  })
})

describe('2 件いっしょに動かす（帯の境目）', () => {
  it('1 つの記録になり、戻すと両方が元に戻る', async () => {
    const first = await create(textPayload)
    const second = await create({ ...textPayload, startSec: 3 })

    const res = await send('POST', `/projects/${project.id}/clips/spans`, {
      spans: [
        { id: first.id, startSec: 0, durationSec: 2 },
        { id: second.id, startSec: 2, durationSec: 4 },
      ],
    })
    expect(res.status).toBe(200)
    const moved = clips.snapshot().map((clip) => [clip.startSec, clip.durationSec])
    expect(moved).toEqual([
      [0, 2],
      [2, 4],
    ])

    const batch = await latest()
    expect(batch).toMatchObject({ summary: 'テロップの境目を動かす', clipCount: 2 })

    await undo(batch.id)
    expect(clips.snapshot()).toEqual([first, second])
  })

  it('別の作品のクリップ・無いクリップが混ざれば何も書かず記録もしない（404）', async () => {
    const first = await create(textPayload)
    const before = await history()
    const res = await send('POST', `/projects/${project.id}/clips/spans`, {
      spans: [
        { id: first.id, startSec: 1, durationSec: 2 },
        { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', startSec: 3, durationSec: 1 },
      ],
    })
    expect(res.status).toBe(404)
    expect(clips.snapshot()).toEqual([first])
    expect(await history()).toEqual(before)
  })

  it('尺 0 は断る（422）', async () => {
    const first = await create(textPayload)
    const res = await send('POST', `/projects/${project.id}/clips/spans`, {
      spans: [{ id: first.id, startSec: 1, durationSec: 0 }],
    })
    expect(res.status).toBe(422)
  })
})
