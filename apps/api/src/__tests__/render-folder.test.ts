import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ProjectId as ProjectIdSchema,
  RenderJob as RenderJobSchema,
  RenderJobId as RenderJobIdSchema,
  TimelineClipId as TimelineClipIdSchema,
  newId,
  type MediaAsset,
  type Project,
  type RenderJob,
} from '@ixa/domain'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import { createMemoryStorage } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import type { FolderOpener, OpenTarget } from '../render-folder/render-folder.js'
import { renderFolderRoutes } from '../routes/render-folder.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aMediaAsset, createInMemoryRenderJobRepository } from './in-memory-timeline-repositories.js'

/**
 * 書き出した動画を手元のフォルダに入れて Finder で開く口（ADR-0036。制作者 2026-10-03「書き出し画面で生成された
 * 動画があるフォルダを開く導線が欲しい」）。押したときに、まだ無い動画をフォルダへ入れてから開く。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }
type Opened = { location: string; copied: number; failed: { reason: string }[] }

const TIME_ZONE = 'Asia/Tokyo'

const aRenderJob = (project: Project, patch: Partial<RenderJob> = {}): RenderJob =>
  RenderJobSchema.parse({
    id: newId(RenderJobIdSchema),
    projectId: project.id,
    scope: { type: 'full' },
    preset: 'preview_720p',
    timelineSnapshot: {
      version: 1,
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      durationSec: 4,
      video1: [],
      transitions: [],
      clips: [],
      audio: [],
    },
    status: 'succeeded',
    progress: 1,
    outputAssetId: null,
    error: null,
    createdAt: new Date('2026-10-02T13:52:31.000Z'),
    finishedAt: new Date('2026-10-02T13:54:00.000Z'),
    ...patch,
  })

let root = ''
let home = ''

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ixa-render-folder-'))
  root = join(home, 'Movies', 'ixa-video-creator')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const build = async (
  options: {
    projectName?: string
    canOpen?: boolean
    missingObject?: boolean
    deletedOutput?: boolean
    openFails?: boolean
    /** 全体の書き出しにテロップを 1 枚入れる。 */
    telop?: boolean
  } = {},
) => {
  const project = aProject({ name: options.projectName ?? 'ぼくははると' })
  const other = aProject()
  const storage = createMemoryStorage()
  const assets: MediaAsset[] = []
  const outputOf = async (label: string, bytes: string, stored = true, listed = true): Promise<MediaAsset> => {
    const key = `renders/${project.id}/${label}.mp4`
    if (stored) await storage.put(key, Buffer.from(bytes), { contentType: 'video/mp4' })
    const asset = aMediaAsset({ storageKey: key, bytes: Buffer.byteLength(bytes), projectId: project.id })
    // 消した素材はリポジトリから引けない（論理削除）。
    if (listed) assets.push(asset)
    return asset
  }
  const fullJob = aRenderJob(project, { outputAssetId: (await outputOf('full', 'FULL-VIDEO')).id })
  const telop = {
    id: newId(TimelineClipIdSchema),
    track: 'TEXT' as const,
    startSec: 1.5,
    durationSec: 2,
    layer: 2,
    opacity: 1,
    content: { type: 'text' as const, templateKey: 'plain', params: { text: '勝負の時が来た' } },
  }
  const full =
    options.telop === true ? { ...fullJob, timelineSnapshot: { ...fullJob.timelineSnapshot, clips: [telop] } } : fullJob
  const range = aRenderJob(project, {
    scope: { type: 'range', start: 0, end: 51.17 },
    createdAt: new Date('2026-10-02T14:00:00.000Z'),
    outputAssetId: (await outputOf('range', 'RANGE', options.missingObject !== true, options.deletedOutput !== true)).id,
  })
  const queued = aRenderJob(project, { status: 'queued', progress: 0, finishedAt: null })
  const foreign = aRenderJob(other)
  const opened: OpenTarget[] = []
  const opener: FolderOpener = {
    canOpen: options.canOpen ?? true,
    open: (target) =>
      options.openFails === true ? Promise.reject(new Error('open が失敗')) : Promise.resolve(void opened.push(target)),
  }
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    renderFolderRoutes({
      projects: createInMemoryProjectRepository([project, other]),
      renderJobs: createInMemoryRenderJobRepository([full, range, queued, foreign]),
      mediaAssets: createInMemoryMediaAssetRepository(assets),
      storage,
      rootDir: root,
      homeDir: home,
      timeZone: TIME_ZONE,
      opener,
      logger: createLogger('silent'),
    }),
  )
  const open = (body: unknown = {}, id: string = project.id, contentType = 'application/json') =>
    app.request(`/projects/${id}/render-folder/open`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: JSON.stringify(body),
    })
  const folder = join(root, 'ぼくははると')
  return { app, project, full, range, queued, foreign, opened, open, folder }
}

const FULL_NAME = 'ぼくははると 2026-10-02 22.52.31 プレビュー（720p）.mp4'
const RANGE_NAME = 'ぼくははると 2026-10-02 23.00.00 プレビュー（720p） 0分00秒〜0分51秒.mp4'

describe('GET /projects/{id}/render-folder', () => {
  it('保存先をホームを ~ にして返し、開けるかを返す', async () => {
    const f = await build()
    const res = await f.app.request(`/projects/${f.project.id}/render-folder`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<{ location: string; canOpen: boolean }>).data).toEqual({
      location: '~/Movies/ixa-video-creator/ぼくははると',
      canOpen: true,
    })
  })

  it('無いプロジェクトは 404', async () => {
    const f = await build()
    expect((await f.app.request(`/projects/${newId(ProjectIdSchema)}/render-folder`)).status).toBe(404)
  })
})

describe('POST /projects/{id}/render-folder/open', () => {
  it('テロップがある書き出しは、同じ名前の字幕ファイル（SRT）を横に置く（動画に出ている字と時刻）', async () => {
    const f = await build({ telop: true })

    await f.open()

    const srt = FULL_NAME.replace(/\.mp4$/, '.srt')
    expect((await readdir(f.folder)).sort()).toEqual([FULL_NAME, srt, RANGE_NAME].sort())
    expect(await readFile(join(f.folder, srt), 'utf8')).toBe('1\n00:00:01,500 --> 00:00:03,500\n勝負の時が来た\n')
  })

  it('字幕ファイルも、もう入っていれば上書きしない（前からある書き出しには後から入る）', async () => {
    const f = await build({ telop: true })
    const srt = join(f.folder, FULL_NAME.replace(/\.mp4$/, '.srt'))
    await f.open()
    await rm(srt)
    await f.open()
    expect(await readFile(srt, 'utf8')).toContain('勝負の時が来た')

    await writeFile(srt, 'EDITED')
    await f.open()
    expect(await readFile(srt, 'utf8')).toBe('EDITED')
  })

  it('終わった書き出しをすべて中身の分かる名前でフォルダへ入れ、フォルダを開く', async () => {
    const f = await build()

    const res = await f.open()

    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<Opened>).data).toEqual({
      location: '~/Movies/ixa-video-creator/ぼくははると',
      copied: 2,
      failed: [],
    })
    expect((await readdir(f.folder)).sort()).toEqual([FULL_NAME, RANGE_NAME].sort())
    expect(await readFile(join(f.folder, FULL_NAME), 'utf8')).toBe('FULL-VIDEO')
    expect(f.opened).toEqual([{ folder: f.folder }])
  })

  it('もう入っているものは書かない。利用者が手を入れたファイルも上書きしない', async () => {
    const f = await build()
    await f.open()

    expect(((await (await f.open()).json()) as Ok<Opened>).data.copied).toBe(0)

    await writeFile(join(f.folder, FULL_NAME), 'EDITED-BY-PERSON')
    expect(((await (await f.open()).json()) as Ok<Opened>).data.copied).toBe(0)
    expect(await readFile(join(f.folder, FULL_NAME), 'utf8')).toBe('EDITED-BY-PERSON')
  })

  it('消した動画は飛ばす（失敗として出し続けない）', async () => {
    const f = await build({ deletedOutput: true })

    const data = ((await (await f.open()).json()) as Ok<Opened>).data

    expect(data).toMatchObject({ copied: 1, failed: [] })
    expect(await readdir(f.folder)).toEqual([FULL_NAME])
  })

  /**
   * JSON 以外の本文は断る。項目がすべて省略可能なので、断らないと別のサイトのページから
   * 下調べの要らない送信（text/plain など）で、フォルダへの書き込みと Finder の起動を起こせる。
   */
  it('JSON 以外の本文は 415。何も書かず、開かない', async () => {
    const f = await build()

    expect((await f.open({}, f.project.id, 'text/plain')).status).toBe(415)
    expect((await f.open({}, f.project.id, 'application/x-www-form-urlencoded')).status).toBe(415)

    expect(f.opened).toEqual([])
    await expect(readdir(f.folder)).rejects.toThrow()
  })

  it('Finder を開けなくても、入れたものは残し、何が起きたかを言葉で返す', async () => {
    const f = await build({ openFails: true })

    const res = await f.open()

    expect(res.status).toBe(500)
    expect(((await res.json()) as Err).error).toMatch(/Finder を開けませんでした/)
    expect(await readdir(f.folder)).toHaveLength(2)
  })

  it('1 本を指定すると、その動画を選んだ状態で開く', async () => {
    const f = await build()

    expect((await f.open({ renderJobId: f.range.id })).status).toBe(200)

    expect(f.opened).toEqual([{ file: join(f.folder, RANGE_NAME) }])
  })

  it('1 本入れられなくても残りは入れ、入れられなかった理由を返す（途中のファイルを残さない）', async () => {
    const f = await build({ missingObject: true })

    const data = ((await (await f.open({ renderJobId: f.range.id })).json()) as Ok<Opened>).data

    expect(data.copied).toBe(1)
    expect(data.failed).toHaveLength(1)
    expect(data.failed[0]?.reason).toMatch(/元の動画が見つかりません/)
    expect(await readdir(f.folder)).toEqual([FULL_NAME])
    // 選ぶはずの 1 本が無いので、フォルダを開く。
    expect(f.opened).toEqual([{ folder: f.folder }])
  })

  it('ほかのプロジェクトの書き出し・まだ終わっていない書き出しは 422。何も書かない', async () => {
    const f = await build()

    const foreign = await f.open({ renderJobId: f.foreign.id })
    expect(foreign.status).toBe(422)
    expect(((await foreign.json()) as Err).fields?.renderJobId?.[0]).toMatch(/このプロジェクトの書き出しではありません/)
    expect((await f.open({ renderJobId: f.queued.id })).status).toBe(422)
    expect(f.opened).toEqual([])
  })

  it('Finder を開けない環境は 409。無いプロジェクトは 404', async () => {
    const f = await build({ canOpen: false })
    expect((await f.open()).status).toBe(409)
    expect(f.opened).toEqual([])
    expect((await f.open({}, newId(ProjectIdSchema))).status).toBe(404)
  })

  it('プロジェクト名に ../ があっても、書き出しフォルダの外に書かない', async () => {
    const f = await build({ projectName: '../../escape' })

    expect((await f.open()).status).toBe(200)

    expect(await readdir(root)).toEqual(['_.._escape'])
    expect(await readdir(home)).toEqual(['Movies'])
  })
})
