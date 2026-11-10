import { join } from 'node:path'
import { CharacterId, DemoManifest, MusicTrackId, ProjectId, ShotId, WorkspaceId, newId } from '@ixa/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DemoBundleSource } from '../demo-project/bundle-source.js'
import { DemoFileError } from '../demo-project/errors.js'
import { demoWriteDeps } from '../demo-project/write-deps.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aWorld, exportToDir, makeTempDir, removeDir, seedCreatorProject } from './demo-fixtures.js'

/**
 * 見本の口（ADR-0067）。`/projects/demo` は `/projects/{id}` に取られない（`demo` を作品の ID として読まない）。
 * 失敗の文は理由だけで、URL・ID・番号を入れない。
 */

type Envelope = { success: boolean; data?: Record<string, unknown>; error?: string }

const workspaceId = newId(WorkspaceId)

describe('GET /projects/demo', () => {
  it('作品の 1 件の口に取られず、目録が無ければ「入れられない」と答える', async () => {
    const app = createTestApp(baseAppDeps())
    const res = await app.request(`/projects/demo?workspaceId=${workspaceId}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Envelope).data).toEqual({ available: false, title: null, totalBytes: null, project: null })
  })

  it('作業場所が無い・形が違えば 422', async () => {
    const app = createTestApp(baseAppDeps())
    expect((await app.request('/projects/demo')).status).toBe(422)
  })
})

describe('POST /projects/demo', () => {
  const post = (bundle?: DemoBundleSource) =>
    createTestApp({ ...baseAppDeps(), ...(bundle === undefined ? {} : { demoBundle: bundle }) }).request('/projects/demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    })

  it('目録が無ければ 404 で「まだ用意されていません」', async () => {
    const res = await post()
    expect(res.status).toBe(404)
    expect(((await res.json()) as Envelope).error).toBe('見本はまだ用意されていません')
  })

  it('中身を読めない目録は、取りに行く前に断る（500。版を上げる案内だけ）', async () => {
    const bundle: DemoBundleSource = {
      manifest: () =>
        Promise.resolve(
          DemoManifest.parse({ formatVersion: 1, demoKey: 'ixa-demo-v1', title: '見本', baseUrl: 'https://github.com/o/r/releases/download/d/', media: [], files: [], source: {} }),
        ),
      fetchFile: () => Promise.reject(new Error('取りに行ってはいけない')),
    }
    const res = await post(bundle)
    expect(res.status).toBe(500)
    expect(((await res.json()) as Envelope).error).toBe('見本の中身を読めませんでした。ixa を新しい版に上げてから、もう一度試してください。')
  })

  describe('中身のそろった目録で', () => {
    let tmp: string
    let manifest: DemoManifest
    beforeAll(async () => {
      tmp = await makeTempDir()
      const creator = aWorld()
      const seeded = await seedCreatorProject(creator, tmp)
      const exported = await exportToDir(creator, seeded.project, join(tmp, 'bundle'))
      // ここの口（baseAppDeps）は声とナレーションを繋いでいない。繋いでいない口に声のある見本は入れない（install の試験）ので、
      // 声を抜いた目録で口の答え方だけを見る。
      manifest = { ...exported, source: { ...exported.source, voices: [], narrationLines: [], narrationTakes: [] } }
    }, 60_000)
    afterAll(async () => {
      await removeDir(tmp)
    })

    it('取りに行けなければ 502 で、次に何をするかだけを言う（URL・番号を入れない）', async () => {
      const res = await post({
        manifest: () => Promise.resolve(manifest),
        fetchFile: (_m, entry) => Promise.reject(new DemoFileError('network', entry.file, '応答 503')),
      })
      expect(res.status).toBe(502)
      const { error } = (await res.json()) as Envelope
      expect(error).toBe('見本のファイルを取りに行けませんでした。インターネットにつながっているか確かめて、もう一度試してください。')
      expect(error).not.toMatch(/503|https?:/)
    })

    it('入れたら 201、もう入っていれば 200 で同じ作品', async () => {
      const deps = { ...baseAppDeps(), demoBundle: { manifest: () => Promise.resolve(manifest), fetchFile: (_m: DemoManifest, entry: { file: string }) => import('node:fs/promises').then((fs) => fs.readFile(join(tmp, 'bundle', entry.file))) } }
      const app = createTestApp(deps)
      const request = () =>
        app.request('/projects/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId }) })
      const first = await request()
      expect(first.status).toBe(201)
      const created = ((await first.json()) as Envelope).data as { project: { id: string; name: string }; created: boolean }
      expect(created).toMatchObject({ created: true, project: { name: '見本の作品' } })
      const second = await request()
      expect(second.status).toBe(200)
      expect(((await second.json()) as Envelope).data).toMatchObject({ created: false, project: { id: created.project.id } })
      const status = await app.request(`/projects/demo?workspaceId=${workspaceId}`)
      expect(((await status.json()) as Envelope).data).toMatchObject({ available: true, title: '見本の作品', project: { id: created.project.id } })
    })
  })
})

describe('見本を書く口（目録が答えない読み）', () => {
  it('書き手が元の作品を読もうとしたら、空を返さずに投げる', async () => {
    const deps = demoWriteDeps(aWorld().writers, [])
    const reads = [
      () => deps.projects.findById(newId(ProjectId)),
      () => deps.shots.findByProject(newId(ProjectId)),
      () => deps.takes.findByShot(newId(ShotId)),
      () => deps.musicAnalyses.findByTrack(newId(MusicTrackId)),
      () => deps.timelineClips.findByProject(newId(ProjectId)),
    ]
    for (const read of reads) await expect(read()).rejects.toThrow('目録が答えない読み')
    // 声の口は繋いである（aWorld）。繋いであれば、読む口は同じく投げる。
    const { voices } = deps
    expect(voices).toBeDefined()
    if (voices !== undefined) await expect(voices.findByProject(newId(ProjectId))).rejects.toThrow('目録が答えない読み')
    // 目録に無いキャラクターの Look を読もうとしても投げる（空の Look で入れない）。
    await expect(Promise.resolve().then(() => deps.looks.findByCharacter(newId(CharacterId)))).rejects.toThrow('Look と画像がありません')
    expect(deps.motionAnalyses).toBeUndefined()
  })
})
