import { OpenAPIHono } from '@hono/zod-openapi'
import { MediaAssetId, ProjectId, TimelineClip, TimelineClipId, newId } from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { clipTextStyleRoutes, MAX_TEXT_STYLE_CLIPS } from '../routes/clip-text-style.js'
import { DUPLICATE_TEXT_STYLE_NAME_MESSAGE, textStyleRoutes } from '../routes/text-styles.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryTextStyleRepository, type InMemoryTextStyleRepository } from './in-memory-text-style-repository.js'
import {
  createInMemoryTimelineClipRepository,
  type InMemoryTimelineClipRepository,
} from './in-memory-timeline-repositories.js'
import { createInMemoryEditBatchRepository, type InMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'

/** テロップのスタイル（ADR-0028）。名前を付けて保存し、まとめて当てる。 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }
type Preset = { id: string; name: string; style: Record<string, unknown>; projectId: string }
type Clip = { id: string; content: { type: string; params?: Record<string, unknown> } }

const project = aProject()
const other = aProject({ name: '別の Project' })

let textStyles: InMemoryTextStyleRepository
let clips: InMemoryTimelineClipRepository
let editBatches: InMemoryEditBatchRepository
let app: OpenAPIHono

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

const aClip = (projectId: ProjectId, content: TimelineClip['content'], startSec = 0): TimelineClip =>
  TimelineClip.parse({
    id: newId(TimelineClipId),
    projectId,
    track: content.type === 'media' ? 'VIDEO2' : 'TEXT',
    startSec,
    durationSec: 2,
    layer: 0,
    content,
    opacity: 1,
    createdAt: new Date(),
  })
const lyric = (text: string, startSec = 0) =>
  aClip(project.id, { type: 'text', templateKey: 'lower_third', params: { text } }, startSec)

beforeEach(() => {
  textStyles = createInMemoryTextStyleRepository()
  clips = createInMemoryTimelineClipRepository()
  editBatches = createInMemoryEditBatchRepository()
  const projects = createInMemoryProjectRepository([project, other])
  app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', textStyleRoutes({ textStyles, projects }))
  app.route('/', clipTextStyleRoutes({ textStyles, projects, timelineClips: clips, editBatches }))
  registerErrorHandlers(app, createLogger('silent'))
})

const createPreset = async (name: string, style: Record<string, unknown> = { color: '#FFD100' }) => {
  const res = await send('POST', `/projects/${project.id}/text-styles`, { name, style })
  expect(res.status).toBe(201)
  return (await json<Ok<Preset>>(res)).data
}

describe('スタイルの保存', () => {
  it('作って一覧に出る', async () => {
    const created = await createPreset('歌詞', { color: '#FFD100', anchor: 'bottom-center' })

    const list = await json<Ok<Preset[]>>(await send('GET', `/projects/${project.id}/text-styles`))
    expect(list.data.map((style) => style.name)).toEqual(['歌詞'])
    expect(created.style).toEqual({ color: '#FFD100', anchor: 'bottom-center' })
  })

  it('同じプロジェクトで同じ名前は 409', async () => {
    await createPreset('歌詞')
    const res = await send('POST', `/projects/${project.id}/text-styles`, { name: ' 歌詞 ', style: {} })
    expect(res.status).toBe(409)
    expect((await json<Err>(res)).fields?.name).toEqual([DUPLICATE_TEXT_STYLE_NAME_MESSAGE])
  })

  it('読めない見た目は 422', async () => {
    const res = await send('POST', `/projects/${project.id}/text-styles`, { name: '歌詞', style: { color: 'red' } })
    expect(res.status).toBe(422)
  })

  it('名前と中身を直せる。他のスタイルと同じ名前には直せない', async () => {
    const lyricStyle = await createPreset('歌詞')
    await createPreset('タイトル')

    const renamed = await send('PATCH', `/text-styles/${lyricStyle.id}`, { name: '歌詞（大）', style: { size: 0.08 } })
    expect(renamed.status).toBe(200)
    expect((await json<Ok<Preset>>(renamed)).data).toMatchObject({ name: '歌詞（大）', style: { size: 0.08 } })

    expect((await send('PATCH', `/text-styles/${lyricStyle.id}`, { name: 'タイトル' })).status).toBe(409)
  })

  it('消すと一覧から消える', async () => {
    const created = await createPreset('歌詞')
    expect((await send('DELETE', `/text-styles/${created.id}`)).status).toBe(204)
    expect((await json<Ok<Preset[]>>(await send('GET', `/projects/${project.id}/text-styles`))).data).toEqual([])
  })

  it('無い Project は 404', async () => {
    expect((await send('GET', `/projects/${newId(ProjectId)}/text-styles`)).status).toBe(404)
  })
})

describe('まとめて当てる', () => {
  it('見た目とスタイルを書き、文字は変えない', async () => {
    const preset = await createPreset('歌詞', { color: '#FFD100' })
    const seeded = [lyric('一行目', 0), lyric('二行目', 2)]
    for (const clip of seeded) await clips.create(clip)
    const ids = clips.snapshot().map((clip) => clip.id)

    const res = await send('POST', `/projects/${project.id}/clips/text-style`, {
      clipIds: ids,
      style: preset.style,
      styleId: preset.id,
    })

    expect(res.status).toBe(200)
    const updated = (await json<Ok<Clip[]>>(res)).data
    expect(updated.map((clip) => clip.content.params)).toEqual([
      { text: '一行目', style: { color: '#FFD100' }, styleId: preset.id },
      { text: '二行目', style: { color: '#FFD100' }, styleId: preset.id },
    ])
  })

  it('スタイルに紐づけず、見た目だけ当てることもできる（styleId: null）', async () => {
    await clips.create(lyric('一行目'))
    const [clip] = clips.snapshot()
    const res = await send('POST', `/projects/${project.id}/clips/text-style`, {
      clipIds: [clip?.id],
      style: { size: 0.05 },
      styleId: null,
    })
    expect((await json<Ok<Clip[]>>(res)).data[0]?.content.params).toEqual({ text: '一行目', style: { size: 0.05 }, styleId: null })
  })

  it('テロップ以外・別の Project のクリップが混じっていれば 422 で何も変えない', async () => {
    await clips.create(lyric('一行目'))
    await clips.create(aClip(project.id, { type: 'media', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), inSec: 0, outSec: 2, volume: 1 }))
    await clips.create(aClip(other.id, { type: 'text', templateKey: 'plain', params: { text: '別' } }))
    const ids = clips.snapshot().map((clip) => clip.id)

    const res = await send('POST', `/projects/${project.id}/clips/text-style`, { clipIds: ids, style: {}, styleId: null })

    expect(res.status).toBe(422)
    expect(Object.keys((await json<Err>(res)).fields ?? {})).toContain('clipIds')
    expect(clips.snapshot()[0]?.content).toEqual({ type: 'text', templateKey: 'lower_third', params: { text: '一行目' } })
  })

  it('無いスタイルを指すと 422', async () => {
    await clips.create(lyric('一行目'))
    const res = await send('POST', `/projects/${project.id}/clips/text-style`, {
      clipIds: clips.snapshot().map((clip) => clip.id),
      style: {},
      styleId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })
    expect(res.status).toBe(422)
    expect(Object.keys((await json<Err>(res)).fields ?? {})).toContain('styleId')
  })

  it('空・多すぎる・読めない見た目は 422', async () => {
    const path = `/projects/${project.id}/clips/text-style`
    expect((await send('POST', path, { clipIds: [], style: {}, styleId: null })).status).toBe(422)
    const many = Array.from({ length: MAX_TEXT_STYLE_CLIPS + 1 }, () => newId(TimelineClipId))
    expect((await send('POST', path, { clipIds: many, style: {}, styleId: null })).status).toBe(422)
    expect((await send('POST', path, { clipIds: [newId(TimelineClipId)], style: { color: 'red' }, styleId: null })).status).toBe(422)
  })
})

/**
 * 変えた項目だけをまとめて変える（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * 大きさだけ変えれば、色や位置・文字・どのスタイルからか（styleId）はテロップごとに今のまま。
 * 変える前の見た目を変更の履歴に残す（取り消せる）。丸ごと当てたときも同じ。
 */
describe('まとめて項目だけ変える', () => {
  const styled = (text: string, style: Record<string, unknown>, styleId: string | null, startSec = 0) =>
    aClip(project.id, { type: 'text', templateKey: 'plain', params: { text, style, styleId } }, startSec)

  it('指定した項目だけ変え、ほかの項目・文字・styleId は残す。外した項目は既定に戻す', async () => {
    await clips.create(styled('一行目', { color: '#FF0000', anchor: 'top-left' }, 'style-a', 0))
    await clips.create(styled('二行目', { color: '#00FF00' }, null, 2))
    const ids = clips.snapshot().map((clip) => clip.id)

    const res = await send('POST', `/projects/${project.id}/clips/text-style`, {
      clipIds: ids,
      set: { size: 0.08 },
      unset: ['anchor'],
    })

    expect(res.status).toBe(200)
    expect((await json<Ok<Clip[]>>(res)).data.map((clip) => clip.content.params)).toEqual([
      { text: '一行目', style: { color: '#FF0000', size: 0.08 }, styleId: 'style-a' },
      { text: '二行目', style: { color: '#00FF00', size: 0.08 }, styleId: null },
    ])
  })

  it('変える前の見た目を変更の履歴に残す（テロップの件数と変えた項目を見出しに）', async () => {
    await clips.create(styled('一行目', { color: '#FF0000' }, 'style-a', 0))
    await clips.create(aClip(project.id, { type: 'text', templateKey: 'plain', params: { text: '二行目' } }, 2))
    const ids = clips.snapshot().map((clip) => clip.id)

    await send('POST', `/projects/${project.id}/clips/text-style`, { clipIds: ids, set: { size: 0.08 }, unset: [] })

    const [batch] = editBatches.snapshot()
    expect(batch?.kind).toBe('text_style')
    expect(batch?.summary).toBe('テロップ 2 件の大きさを変えました')
    expect(batch?.entries).toEqual([])
    expect(batch?.clipEntries).toEqual([
      { clipId: ids[0], style: { color: '#FF0000' }, styleId: 'style-a' },
      { clipId: ids[1], style: null, styleId: null },
    ])
  })

  it('丸ごと当てたときも履歴に残す', async () => {
    await clips.create(styled('一行目', { color: '#FF0000' }, null))
    const ids = clips.snapshot().map((clip) => clip.id)

    await send('POST', `/projects/${project.id}/clips/text-style`, { clipIds: ids, style: { size: 0.05 }, styleId: null })

    expect(editBatches.snapshot()[0]?.clipEntries).toEqual([{ clipId: ids[0], style: { color: '#FF0000' }, styleId: null }])
    expect(editBatches.snapshot()[0]?.summary).toBe('テロップ 1 件に見た目を当てました')
  })

  it('丸ごとと項目だけを混ぜた・片方だけの本文は 422 で、どう送るかを言う', async () => {
    await clips.create(styled('一行目', {}, null))
    const ids = clips.snapshot().map((clip) => clip.id)
    const path = `/projects/${project.id}/clips/text-style`

    for (const payload of [
      { clipIds: ids, style: {}, styleId: null, set: { size: 0.05 }, unset: [] },
      { clipIds: ids, set: { size: 0.05 } },
      { clipIds: ids, style: {} },
    ]) {
      const res = await send('POST', path, payload)
      expect(res.status).toBe(422)
      expect(JSON.stringify(await json<Err>(res))).toMatch(/set と unset/)
    }
    expect(editBatches.snapshot()).toEqual([])
  })

  it('範囲の外の値・知らない項目・テロップ以外は 422 で、何も変えず記録もしない', async () => {
    await clips.create(styled('一行目', { color: '#FF0000' }, null))
    await clips.create(aClip(project.id, { type: 'media', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), inSec: 0, outSec: 2, volume: 1 }))
    const [text, media] = clips.snapshot()
    const path = `/projects/${project.id}/clips/text-style`

    expect((await send('POST', path, { clipIds: [text?.id], set: { size: 0.9 }, unset: [] })).status).toBe(422)
    expect((await send('POST', path, { clipIds: [text?.id], set: {}, unset: ['sise'] })).status).toBe(422)
    expect((await send('POST', path, { clipIds: [text?.id, media?.id], set: { size: 0.05 }, unset: [] })).status).toBe(422)
    expect(clips.snapshot()[0]?.content).toEqual({ type: 'text', templateKey: 'plain', params: { text: '一行目', style: { color: '#FF0000' }, styleId: null } })
    expect(editBatches.snapshot()).toEqual([])
  })
})
