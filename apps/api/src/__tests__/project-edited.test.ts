import { TimelineClipId as TimelineClipIdSchema, newId, type ProjectEvent } from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import type { AppDeps } from '../app.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createFailingProjectEventPublisher, createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryTimelineClipRepository } from './in-memory-timeline-repositories.js'

/**
 * 作品を書き換えたら `project.edited` を流す（2026-10-30）。
 *
 * 制作者の報告: 画面を開いたまま、エージェントが MCP の `edit_clips`（→ `PATCH /clips/{id}`）でテロップの縁の色を
 * 99 件変えたが、画面は読み直すまで古い色のままだった。書き込みの口が何も流していなかった。
 */

const send = (
  app: ReturnType<typeof createTestApp>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const TEXT_CLIP = {
  track: 'TEXT',
  startSec: 0,
  durationSec: 3,
  content: { type: 'text', templateKey: 'lower-third', params: { label: 'iXA CUP' } },
}

const setup = (overrides: Partial<AppDeps> = {}) => {
  const project = aProject()
  const shot = aShot(project.id, { startSec: 0, durationSec: 4 })
  const events = createInMemoryProjectEvents()
  const deps: AppDeps = {
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots: createInMemoryShotRepository([shot]),
    timelineClips: createInMemoryTimelineClipRepository(),
    events,
    ...overrides,
  }
  const app = createTestApp(deps)
  const addClip = async (): Promise<string> => {
    const res = await send(app, 'POST', `/projects/${project.id}/clips`, TEXT_CLIP)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { id: string } }
    return body.data.id
  }
  const edited = (): readonly ProjectEvent[] => events.published().filter((event) => event.type === 'project.edited')
  return { app, project, shot, events, addClip, edited }
}

const STROKE = { content: { ...TEXT_CLIP.content, params: { label: 'iXA CUP', style: { stroke: { color: '#ff0000', width: 0.1 } } } } }

describe('作品を書き換えたら project.edited を流す', () => {
  it('テロップを直す（PATCH /clips/{id}）と、その作品の出来事が 1 件流れる。印の無い書き込みは origin が null', async () => {
    const f = setup()
    const clipId = await f.addClip()
    const before = f.edited().length

    const res = await send(f.app, 'PATCH', `/clips/${clipId}`, STROKE)

    expect(res.status).toBe(200)
    const after = f.edited().slice(before)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ type: 'project.edited', projectId: f.project.id, origin: null })
  })

  it('画面の印（X-Ixa-Client）を origin に載せる。形の悪い印は null に落とす', async () => {
    const f = setup()
    const clipId = await f.addClip()
    await send(f.app, 'PATCH', `/clips/${clipId}`, STROKE, { 'x-ixa-client': 'tab_01' })
    await send(f.app, 'PATCH', `/clips/${clipId}`, STROKE, { 'x-ixa-client': 'bad value!' })
    expect(f.edited().slice(-2).map((event) => event.type === 'project.edited' && event.origin)).toEqual(['tab_01', null])
  })

  it('テロップを足す・消す（消す口は消す前に作品を引く）', async () => {
    const f = setup()
    const clipId = await f.addClip()
    expect(f.edited()).toHaveLength(1)
    const res = await send(f.app, 'DELETE', `/clips/${clipId}`)
    expect(res.status).toBe(204)
    expect(f.edited()).toHaveLength(2)
    expect(f.edited()[1]).toMatchObject({ projectId: f.project.id })
  })

  it('Shot を直す（PATCH /shots/{id}）でも流れる', async () => {
    const f = setup()
    const res = await send(f.app, 'PATCH', `/shots/${f.shot.id}`, { description: '夕焼けの屋上' })
    expect(res.status).toBe(200)
    expect(f.edited()).toEqual([expect.objectContaining({ projectId: f.project.id })])
  })

  it('読むだけ・失敗した書き込みでは流さない', async () => {
    const f = setup()
    await send(f.app, 'GET', `/projects/${f.project.id}/clips`)
    const missing = await send(f.app, 'PATCH', `/clips/${newId(TimelineClipIdSchema)}`, STROKE)
    expect(missing.status).toBe(404)
    expect(f.edited()).toEqual([])
  })

  it('流すのに失敗しても、書き込みは成功のまま返す', async () => {
    const failing = createFailingProjectEventPublisher()
    const f = setup({ events: { ...createInMemoryProjectEvents(), publish: failing.publish } })
    const res = await send(f.app, 'POST', `/projects/${f.project.id}/clips`, TEXT_CLIP)
    expect(res.status).toBe(201)
    expect(failing.attempts()).toBe(1)
  })
})
