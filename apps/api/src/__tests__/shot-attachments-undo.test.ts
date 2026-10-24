import {
  aShot,
  createInMemoryCharacterLookRepository,
  createInMemoryCharacterRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryShotCharacterRepository,
  createInMemoryShotReferenceRepository,
  createInMemoryShotRepository,
} from '@ixa/generation/testing'
import { manualEndFrameOf, manualStartFrameOf } from '@ixa/generation'
import { describe, expect, it } from 'vitest'
import type { EditBatchSummaryResponse } from '../routes/edit-batches.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'

/**
 * Shot の登場人物・開始フレームを取り消す（2026-10-19 の見直し・段 5）。
 * 登場人物は丸ごと、開始フレームは付いていた素材を控え、書き込みと同じトランザクションで記録する。
 */

const project = aProject()

const build = async (options: { readonly recordFails?: boolean } = {}) => {
  const shot = aShot(project.id, { code: 'CUT-05' })
  const characters = createInMemoryCharacterRepository()
  const looks = createInMemoryCharacterLookRepository()
  const shotCharacters = createInMemoryShotCharacterRepository()
  const shotReferences = createInMemoryShotReferenceRepository()
  const shots = createInMemoryShotRepository([shot])
  const editBatches = createInMemoryEditBatchRepository()
  const recorder =
    options.recordFails === true ? { ...editBatches, create: () => Promise.reject(new Error('記録を作れません')) } : editBatches
  const image = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/png' })
  const other = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/png' })
  const hero = await characters.create({ workspaceId: project.workspaceId, projectId: project.id, name: '戦子', displayName: '戦子' })
  const look = await looks.create({ characterId: hero.id, key: 'STAGE_A', name: '戦子のステージ衣装' })
  const app = createTestApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots,
    characters,
    looks,
    shotCharacters,
    shotReferences,
    mediaAssets: createInMemoryMediaAssetRepository([image, other]),
    editBatches: recorder,
  })
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const latest = async (): Promise<EditBatchSummaryResponse | undefined> =>
    ((await (await app.request(`/projects/${project.id}/edit-batches`)).json()) as { data: EditBatchSummaryResponse[] }).data[0]
  const undo = (id: string) => send('POST', `/projects/${project.id}/edit-batches/${id}/undo`)
  const cast = [{ characterId: hero.id, lookId: look.id, prominence: 'primary', order: 0 }]
  return { shot, shots, shotCharacters, shotReferences, image, other, send, latest, undo, cast, hero }
}

describe('登場人物', () => {
  it('変えると記録が残り、戻すと前の登場人物に戻る', async () => {
    const f = await build()
    expect((await f.send('PUT', `/shots/${f.shot.id}/characters`, { entries: f.cast })).status).toBe(200)
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'shot_edit', summary: 'CUT-05 の登場人物を変える' })

    expect((await f.undo(batch!.id)).status).toBe(200)
    expect(await f.shotCharacters.findByShot(f.shot.id)).toEqual([])
  })

  it('外すと記録が残り、戻すとまた登場する', async () => {
    const f = await build()
    await f.send('PUT', `/shots/${f.shot.id}/characters`, { entries: f.cast })
    expect((await f.send('DELETE', `/shots/${f.shot.id}/characters/${f.hero.id}`)).status).toBe(204)
    const batch = await f.latest()
    await f.undo(batch!.id)
    expect((await f.shotCharacters.findByShot(f.shot.id)).map((entry) => entry.characterId)).toEqual([f.hero.id])
  })

  it('同じ登場人物を送り直しても記録しない', async () => {
    const f = await build()
    await f.send('PUT', `/shots/${f.shot.id}/characters`, { entries: [] })
    expect(await f.latest()).toBeUndefined()
  })

  it('記録が作れなければ変えない', async () => {
    const f = await build({ recordFails: true })
    expect((await f.send('PUT', `/shots/${f.shot.id}/characters`, { entries: f.cast })).status).toBe(500)
    expect(await f.shotCharacters.findByShot(f.shot.id)).toEqual([])
  })
})

describe('開始フレーム', () => {
  it('付ける・差し替える・外すを記録し、戻すと前の素材に戻る', async () => {
    const f = await build()
    await f.send('PUT', `/shots/${f.shot.id}/start-frame`, { mediaAssetId: f.image.id })
    await f.send('PUT', `/shots/${f.shot.id}/start-frame`, { mediaAssetId: f.other.id })
    const replaced = await f.latest()
    expect(replaced?.summary).toBe('CUT-05 の開始フレームを変える')

    await f.undo(replaced!.id)
    expect(await manualStartFrameOf(f.shotReferences, f.shot.id)).toBe(f.image.id)

    expect((await f.send('DELETE', `/shots/${f.shot.id}/start-frame`)).status).toBe(204)
    await f.undo((await f.latest())!.id)
    expect(await manualStartFrameOf(f.shotReferences, f.shot.id)).toBe(f.image.id)
  })

  it('記録が作れなければ付けない', async () => {
    const f = await build({ recordFails: true })
    expect((await f.send('PUT', `/shots/${f.shot.id}/start-frame`, { mediaAssetId: f.image.id })).status).toBe(500)
    expect(await manualStartFrameOf(f.shotReferences, f.shot.id)).toBeNull()
  })
})

describe('終わりの画像', () => {
  it('付けると尺に合わせる再生になり、戻すと画像も再生の仕方も前に戻る', async () => {
    const f = await build()
    expect((await f.send('PUT', `/shots/${f.shot.id}/end-frame`, { mediaAssetId: f.image.id })).status).toBe(200)
    expect((await f.shots.findById(f.shot.id))?.timing).toBe('fit')
    const batch = await f.latest()
    expect(batch?.summary).toBe('CUT-05 の終わりの画像を変える')

    expect((await f.undo(batch!.id)).status).toBe(200)
    expect(await manualEndFrameOf(f.shotReferences, f.shot.id)).toBeNull()
    expect((await f.shots.findById(f.shot.id))?.timing).toBe('trim')
  })

  it('外したのを戻すと、前の画像が付き直る', async () => {
    const f = await build()
    await f.send('PUT', `/shots/${f.shot.id}/end-frame`, { mediaAssetId: f.image.id })
    expect((await f.send('DELETE', `/shots/${f.shot.id}/end-frame`)).status).toBe(204)
    await f.undo((await f.latest())!.id)
    expect(await manualEndFrameOf(f.shotReferences, f.shot.id)).toBe(f.image.id)
  })
})
