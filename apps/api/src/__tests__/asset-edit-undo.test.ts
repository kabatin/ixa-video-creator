import { OpenAPIHono } from '@hono/zod-openapi'
import { BrandAssetId, CharacterId, LocationId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { editBatchRoutes, type EditBatchSummaryResponse, type UndoEditBatchResponse } from '../routes/edit-batches.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { setupNarration } from './narration-fixture.js'

/**
 * 素材（キャラクター・ロケーション・ブランド資産・声）の作る・直す・消すを取り消す（2026-10-19 の見直し・段 5）。
 * どれも論理削除なので、消したものは戻すと同じ ID・同じ中身。直したものは変えた欄だけが戻る。
 */

type Ok<T> = { success: true; data: T }

const project = aProject()

const build = (options: { readonly recordFails?: boolean } = {}) => {
  const editBatches = createInMemoryEditBatchRepository()
  const recorder =
    options.recordFails === true ? { ...editBatches, create: () => Promise.reject(new Error('記録を作れません')) } : editBatches
  const deps = { ...baseAppDeps(), projects: createInMemoryProjectRepository([project]), editBatches: recorder }
  const app = createTestApp(deps)
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const created = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await send('POST', path, body)
    expect(res.status).toBe(201)
    return ((await res.json()) as Ok<T>).data
  }
  const latest = async (): Promise<EditBatchSummaryResponse | undefined> =>
    ((await (await app.request(`/projects/${project.id}/edit-batches`)).json()) as { data: EditBatchSummaryResponse[] }).data[0]
  const undo = async (id: string): Promise<UndoEditBatchResponse> => {
    const res = await send('POST', `/projects/${project.id}/edit-batches/${id}/undo`)
    expect(res.status).toBe(200)
    return ((await res.json()) as Ok<UndoEditBatchResponse>).data
  }
  return { deps, send, created, latest, undo }
}

describe('キャラクター', () => {
  it('消すと記録が残り、戻すと同じ ID・同じ中身で戻る', async () => {
    const f = build()
    const hero = await f.created<{ id: string; name: string }>(`/projects/${project.id}/characters`, { name: '戦子', displayName: '戦子' })
    const stored = await f.deps.characters.findById(CharacterId.parse(hero.id))
    expect((await f.send('DELETE', `/characters/${hero.id}`)).status).toBe(204)
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'asset_edit', summary: 'キャラクター「戦子」を消す' })

    const result = await f.undo(batch!.id)
    expect(result.restoredAssets).toEqual([hero.id])
    expect(await f.deps.characters.findById(CharacterId.parse(hero.id))).toEqual(stored)
  })

  it('作ると記録が残り、戻すと消える。直すと変えた欄だけが戻る', async () => {
    const f = build()
    const hero = await f.created<{ id: string }>(`/projects/${project.id}/characters`, { name: '戦子', displayName: '戦子' })
    const made = await f.latest()
    expect(made?.summary).toBe('キャラクター「戦子」を作る')

    await f.send('PATCH', `/characters/${hero.id}`, { displayName: 'センコ' })
    const renamed = await f.latest()
    await f.send('PATCH', `/characters/${hero.id}`, { description: '元気' })
    await f.undo(renamed!.id)
    expect(await f.deps.characters.findById(CharacterId.parse(hero.id))).toMatchObject({ displayName: '戦子', description: '元気' })

    await f.undo(made!.id)
    expect(await f.deps.characters.findById(CharacterId.parse(hero.id))).toBeNull()
  })

  it('記録が作れなければ作らない', async () => {
    const f = build({ recordFails: true })
    expect((await f.send('POST', `/projects/${project.id}/characters`, { name: '戦子', displayName: '戦子' })).status).toBe(500)
    expect(await f.deps.characters.findByProject(project.id)).toEqual([])
  })
})

describe('ロケーション・ブランド資産', () => {
  it('ロケーションを消して戻すと同じ ID で戻る', async () => {
    const f = build()
    const place = await f.created<{ id: string }>(`/projects/${project.id}/locations`, { name: '夕方の店', description: '' })
    await f.send('DELETE', `/locations/${place.id}`)
    await f.undo((await f.latest())!.id)
    expect((await f.deps.locations.findById(LocationId.parse(place.id)))?.name).toBe('夕方の店')
  })

  it('ブランド資産を直して戻すと、前の値に戻る', async () => {
    const f = build()
    const color = await f.created<{ id: string }>(`/projects/${project.id}/brand-assets`, { category: 'color', name: 'iXA Yellow', value: '#FFD200' })
    await f.send('PATCH', `/brand-assets/${color.id}`, { value: '#000000' })
    const batch = await f.latest()
    expect(batch?.summary).toBe('ブランド資産「iXA Yellow」を直す')
    await f.undo(batch!.id)
    expect((await f.deps.brandAssets.findById(BrandAssetId.parse(color.id)))?.value).toBe('#FFD200')
  })

  it('記録が作れなければ消さない', async () => {
    const f = build({ recordFails: true })
    const place = await f.deps.locations.create({ workspaceId: project.workspaceId, projectId: project.id, name: '夕方の店', description: '' })
    expect((await f.send('DELETE', `/locations/${place.id}`)).status).toBe(500)
    expect((await f.deps.locations.findById(place.id))?.name).toBe('夕方の店')
  })
})

describe('声', () => {
  const undoApp = (setup: ReturnType<typeof setupNarration>) => {
    const app = new OpenAPIHono({ defaultHook: validationHook })
    app.route(
      '/',
      editBatchRoutes({
        projects: setup.deps.projects,
        shots: {
          findById: () => Promise.reject(new Error('Shot は触らない')),
          update: () => Promise.reject(new Error('Shot は触らない')),
          selectTake: () => Promise.reject(new Error('Shot は触らない')),
          updateStatus: () => Promise.reject(new Error('Shot は触らない')),
          softDelete: () => Promise.reject(new Error('Shot は触らない')),
          restore: () => Promise.reject(new Error('Shot は触らない')),
        },
        timelineClips: setup.deps.timelineClips,
        editBatches: setup.editBatches,
        narration: setup.deps,
        voices: setup.deps.voices,
      }),
    )
    registerErrorHandlers(app, createLogger('silent'))
    return (id: string) => app.request(`/projects/${setup.project.id}/edit-batches/${id}/undo`, { method: 'POST' })
  }

  it('消すと、その声で話す行も「声が未定」になり、戻すと声も行も戻る', async () => {
    const setup = setupNarration()
    const voice = await setup.deps.voices.create({ projectId: setup.project.id, name: 'ナレーター', tool: 'stub', voiceName: 'stub' })
    const [line] = await setup.deps.lines.createMany([{ projectId: setup.project.id, order: 0, text: 'あ。', voiceProfileId: voice.id }])

    expect((await setup.send('DELETE', `/voices/${voice.id}`)).status).toBe(204)
    expect(setup.deps.lines.snapshot()[0]?.voiceProfileId).toBeNull()
    const [batch] = setup.editBatches.snapshot()
    expect(batch).toMatchObject({ kind: 'asset_edit', summary: '声「ナレーター」を消す' })

    expect((await undoApp(setup)(batch!.id)).status).toBe(200)
    expect(await setup.deps.voices.findById(voice.id)).toEqual(voice)
    expect((await setup.deps.lines.findById(line!.id))?.voiceProfileId).toBe(voice.id)
  })
})
