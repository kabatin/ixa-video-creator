import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { newId, MediaAssetId as MediaAssetIdSchema, type MediaAsset, type Shot } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryMediaAssetRepository,
  createInMemoryShotReferenceRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createFsStorage } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import type { FolderOpener, OpenTarget } from '../render-folder/render-folder.js'
import { assetFolderRoutes } from '../routes/asset-folder.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'

/**
 * 作った素材を手元のフォルダから開けるようにする口（ADR-0041。制作者 2026-10-07
 * 「作った素材は個別に何かに使いたいこともあると思うので、普通にフォルダ開いて見れるといいな」）。
 *
 * **ハードリンクで張る**ので、容量が増えず、ここのファイルを消しても保管庫は無傷。
 */

type Ok<T> = { success: true; data: T }
type Opened = { location: string; linked: number; failed: { reason: string }[] }

const SECRET = 's'.repeat(32)
const WORKSPACE = '01M2M39QA1PPAWH1YZ1E9K5SZW'

let home = ''
let root = ''
let storageRoot = ''

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ixa-asset-folder-'))
  root = join(home, 'Movies', 'ixa-video-creator')
  // 保管庫も同じ場所の下に置く（ハードリンクは同じディスクの中にしか張れない）。
  storageRoot = join(home, 'ixa-video-creator', 'storage')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const build = async (options: { canOpen?: boolean; missingObject?: boolean } = {}) => {
  const storage = createFsStorage({
    root: storageRoot,
    publicBaseUrl: 'http://127.0.0.1:3001',
    signingSecret: SECRET,
  })
  const project = aProject({ name: 'ぼくははると' })
  const assets: MediaAsset[] = []

  /** 素材を 1 つ作り、保管庫にも実体を置く。 */
  const anAsset = async (extension: string, body: string, stored = true): Promise<MediaAsset> => {
    const id = newId(MediaAssetIdSchema)
    const key = `media/${WORKSPACE}/${id}/original.${extension}`
    if (stored) await storage.put(key, new TextEncoder().encode(body), { contentType: 'video/mp4' })
    const asset = aMediaAsset({ id, storageKey: key, bytes: body.length, projectId: project.id })
    assets.push(asset)
    return asset
  }

  const firstTakeAsset = await anAsset('mp4', 'TAKE-1')
  const secondTakeAsset = await anAsset('mp4', 'TAKE-2')
  const lastShotTakeAsset = await anAsset('mp4', 'TAKE-3', options.missingObject !== true)
  const startFrameAsset = await anAsset('png', 'START-FRAME')

  const first = aShot(project.id, { code: 'CUT-01', order: 1000 })
  const second = aShot(project.id, { code: 'CUT-02', order: 2000 })
  /** specHash は 64 桁。中身は見ないので番号で埋める。 */
  const aHash = (n: number): string => String(n).repeat(64).slice(0, 64)
  const takes = [
    aTake(first, aHash(1), { index: 1, mediaAssetId: firstTakeAsset.id }),
    aTake(first, aHash(2), { index: 2, mediaAssetId: secondTakeAsset.id }),
    aTake(second, aHash(3), { index: 1, mediaAssetId: lastShotTakeAsset.id }),
  ]
  // 2 本目を採用した Shot（Finder で本編に入っている方が分かること）。
  const adopted: Shot = { ...first, selectedTakeId: takes[1]?.id ?? null }

  const shotReferences = createInMemoryShotReferenceRepository()
  await shotReferences.create({
    shotId: first.id,
    mediaAssetId: startFrameAsset.id,
    role: 'start_frame',
    weight: 1,
    order: 0,
    sourceKind: 'manual',
  })

  const opened: OpenTarget[] = []
  const opener: FolderOpener = {
    canOpen: options.canOpen ?? true,
    open: (target) => Promise.resolve(void opened.push(target)),
  }

  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    assetFolderRoutes({
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([adopted, second]),
      takes: createInMemoryTakeRepository(takes),
      shotReferences,
      mediaAssets: createInMemoryMediaAssetRepository(assets),
      storage,
      rootDir: root,
      homeDir: home,
      opener,
      logger: createLogger('silent'),
    }),
  )

  const open = (contentType = 'application/json', id: string = project.id) =>
    app.request(`/projects/${id}/asset-folder/open`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: JSON.stringify({}),
    })

  return { app, project, open, opened, storage, firstTakeAsset, folder: join(root, 'ぼくははると', '素材') }
}

describe('POST /projects/{id}/asset-folder/open', () => {
  it('Shot の順に並ぶ読める名前で入れる', async () => {
    const { open, folder } = await build()

    const response = await open()

    expect(response.status).toBe(200)
    expect(((await response.json()) as Ok<Opened>).data.linked).toBe(4)
    expect((await readdir(folder)).sort()).toEqual([
      'CUT-01 Take 1.mp4',
      'CUT-01 Take 2 採用.mp4',
      'CUT-01 最初のフレーム.png',
      'CUT-02 Take 1.mp4',
    ])
  })

  /** コピーではないので容量が増えない。ここのファイルを消しても保管庫は無傷。 */
  it('コピーではなくハードリンクを張る', async () => {
    const { open, folder, storage, firstTakeAsset } = await build()
    await open()

    const linked = await stat(join(folder, 'CUT-01 Take 1.mp4'))
    const source = await stat(await storage.localPath(firstTakeAsset.storageKey))

    // 同じ実体（inode）を 2 つの名前が指している。
    expect(linked.ino).toBe(source.ino)
    expect(linked.nlink).toBe(2)
  })

  /** `~/Movies` は利用者が触る場所。もう入っているものは触らない。 */
  it('2 回目は何もしない（入れ直さない）', async () => {
    const { open, folder } = await build()
    await open()
    const before = await stat(join(folder, 'CUT-01 Take 1.mp4'))

    const second = await open()

    expect(((await second.json()) as Ok<Opened>).data.linked).toBe(0)
    expect((await stat(join(folder, 'CUT-01 Take 1.mp4'))).ino).toBe(before.ino)
  })

  /**
   * もう入っているものは、**元の素材を見に行かない**。
   * 見に行くと、保管庫から消した素材を毎回「見つかりません」と言い続ける（ADR-0036 と同じ考え方）。
   */
  it('もう入っていれば、元の素材が消えていても失敗にしない', async () => {
    const { open, storage, firstTakeAsset } = await build()
    await open()
    await storage.delete(firstTakeAsset.storageKey)

    const data = ((await (await open()).json()) as Ok<Opened>).data

    expect(data.failed).toEqual([])
    expect(data.linked).toBe(0)
  })

  /** 1 つの失敗で止めない。入れられなかったものは理由を返す。 */
  it('元の素材が無ければ、理由を返して残りは入れる', async () => {
    const { open, folder } = await build({ missingObject: true })

    const data = ((await (await open()).json()) as Ok<Opened>).data

    expect(data.linked).toBe(3)
    expect(data.failed).toHaveLength(1)
    expect(data.failed[0]?.reason).toContain('CUT-02 Take 1.mp4')
    expect(data.failed[0]?.reason).toContain('元の素材が見つかりません')
    expect(await readdir(folder)).not.toContain('CUT-02 Take 1.mp4')
  })

  it('素材フォルダを Finder で開く', async () => {
    const { open, opened, folder } = await build()

    await open()

    expect(opened).toEqual([{ folder }])
  })

  it('Finder を開けない環境では断る（書き込みもしない）', async () => {
    const { open, opened } = await build({ canOpen: false })

    expect((await open()).status).toBe(409)
    expect(opened).toEqual([])
  })

  /** ADR-0036 と同じ理由。別のサイトのページから、書き込みと Finder の起動を起こさせない。 */
  it('本文が JSON でなければ断る', async () => {
    const { open, opened } = await build()

    expect((await open('text/plain')).status).toBe(415)
    expect(opened).toEqual([])
  })
})

describe('GET /projects/{id}/asset-folder', () => {
  it('保存先をホームからの形で返す', async () => {
    const { app, project } = await build()

    const response = await app.request(`/projects/${project.id}/asset-folder`)
    const data = ((await response.json()) as Ok<{ location: string; canOpen: boolean }>).data

    expect(data.location).toBe('~/Movies/ixa-video-creator/ぼくははると/素材')
    expect(data.canOpen).toBe(true)
  })
})
