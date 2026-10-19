import { OpenAPIHono } from '@hono/zod-openapi'
import type { UploadedSfxRepository } from '@ixa/db'
import { newId, UploadedSfxId as UploadedSfxIdSchema, type MediaAsset, type UploadedSfx } from '@ixa/domain'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { MISSING_SFX_ASSET_MESSAGE, NOT_AUDIO_SFX_MESSAGE, uploadedSfxRoutes } from '../routes/uploaded-sfx.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'

/**
 * 手元のファイルから取り込んだ効果音（ADR-0056）。上げた音の素材を作品の効果音として記す。段には置かない。
 * 同じ作品（またはどの作品にも属さない）・同じワークスペースの音の素材だけを受ける。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }
type Wire = { id: string; mediaAssetId: string; title: string; createdAt: string }

const createInMemoryUploadedSfxRepository = (): UploadedSfxRepository => {
  let rows: readonly UploadedSfx[] = []
  return {
    create: (input) => {
      const row = { id: newId(UploadedSfxIdSchema), ...input, createdAt: new Date() }
      rows = [...rows, row]
      return Promise.resolve(row)
    },
    findByProject: (projectId) => Promise.resolve(rows.filter((row) => row.projectId === projectId).reverse()),
  }
}

const setup = () => {
  const project = aProject()
  const other = aProject()
  const audio = (overrides: Partial<MediaAsset> = {}) =>
    aMediaAsset({ kind: 'audio', mimeType: 'audio/wav', workspaceId: project.workspaceId, projectId: project.id, ...overrides })
  const sound = audio()
  const video = aMediaAsset({ workspaceId: project.workspaceId, projectId: project.id })
  const elsewhere = audio({ projectId: other.id })
  const otherWorkspace = audio({ workspaceId: other.workspaceId })
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route(
    '/',
    uploadedSfxRoutes({
      projects: createInMemoryProjectRepository([project, other]),
      mediaAssets: createInMemoryMediaAssetRepository([sound, video, elsewhere, otherWorkspace]),
      uploadedSfx: createInMemoryUploadedSfxRepository(),
    }),
  )
  registerErrorHandlers(app, createLogger('silent'))
  const send = (method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  return { project, other, sound, video, elsewhere, otherWorkspace, send }
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

describe('POST /projects/{projectId}/uploaded-sfx', () => {
  it('音の素材を名前つきで記し、一覧に出す', async () => {
    const { project, sound, send } = setup()

    const created = await send('POST', `/projects/${project.id}/uploaded-sfx`, { mediaAssetId: sound.id, title: ' ドアの音 ' })

    expect(created.status).toBe(201)
    const body = (await json<Ok<Wire>>(created)).data
    expect(body).toMatchObject({ mediaAssetId: sound.id, title: 'ドアの音' })
    const list = await send('GET', `/projects/${project.id}/uploaded-sfx`)
    expect((await json<Ok<Wire[]>>(list)).data.map((row) => row.id)).toEqual([body.id])
  })

  it('音でない素材は断る', async () => {
    const { project, video, send } = setup()
    const res = await send('POST', `/projects/${project.id}/uploaded-sfx`, { mediaAssetId: video.id, title: '映像' })
    expect(res.status).toBe(422)
    expect((await json<Err>(res)).fields?.mediaAssetId).toEqual([NOT_AUDIO_SFX_MESSAGE])
  })

  it('別の作品・別のワークスペースの素材、無い素材は断る', async () => {
    const { project, elsewhere, otherWorkspace, send } = setup()
    for (const mediaAssetId of [elsewhere.id, otherWorkspace.id, aMediaAsset().id]) {
      const res = await send('POST', `/projects/${project.id}/uploaded-sfx`, { mediaAssetId, title: '音' })
      expect(res.status).toBe(422)
      expect((await json<Err>(res)).fields?.mediaAssetId).toEqual([MISSING_SFX_ASSET_MESSAGE])
    }
  })

  it('名前が空・余分な欄があれば断る', async () => {
    const { project, sound, send } = setup()
    const empty = await send('POST', `/projects/${project.id}/uploaded-sfx`, { mediaAssetId: sound.id, title: ' ' })
    expect(empty.status).toBe(422)
    const extra = await send('POST', `/projects/${project.id}/uploaded-sfx`, { mediaAssetId: sound.id, title: '音', startSec: 1 })
    expect(extra.status).toBe(422)
  })

  it('作品が無ければ 404', async () => {
    const { sound, send } = setup()
    const missing = aProject().id
    expect((await send('POST', `/projects/${missing}/uploaded-sfx`, { mediaAssetId: sound.id, title: '音' })).status).toBe(404)
    expect((await send('GET', `/projects/${missing}/uploaded-sfx`)).status).toBe(404)
  })

  it('一覧は作品ごと', async () => {
    const { project, other, sound, send } = setup()
    await send('POST', `/projects/${project.id}/uploaded-sfx`, { mediaAssetId: sound.id, title: '音' })
    expect((await json<Ok<Wire[]>>(await send('GET', `/projects/${other.id}/uploaded-sfx`))).data).toEqual([])
  })
})
