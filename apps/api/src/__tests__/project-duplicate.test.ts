import { OpenAPIHono } from '@hono/zod-openapi'
import {
  DUPLICATION_ITEMS,
  MediaAssetId,
  MusicAnalysis,
  MusicAnalysisId,
  computeSpecHash,
  newId,
  type DuplicationItem,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotCharacterRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { projectDuplicateRoutes, type ProjectDuplicateRoutesDeps } from '../routes/project-duplicate.js'
import { baseAppDeps } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * プロジェクトを複製する（制作者 2026-10-04「持って行きたいところだけ持っていけるようにすると超便利」）。
 * 見たいのは 3 つ。**選んだものだけが新しい ID で写り、ファイルは同じものを指し、元は変わらない。**
 */

type Ok<T> = { success: true; data: T }
type Duplicated = { project: { id: string; name: string }; notes: string[] }

const analysisOf = (musicTrackId: string): MusicAnalysis =>
  MusicAnalysis.parse({
    id: newId(MusicAnalysisId),
    musicTrackId,
    analyzerVersion: 'librosa-v1',
    durationSec: 24,
    bpm: 120,
    bpmConfidence: 0.9,
    beats: [0, 0.5, 1],
    downbeats: [0],
    sections: [{ start: 0, end: 24, label: 'intro', energy: 0.3 }],
    energyCurve: { hopSec: 0.1, values: [0.1, 0.2] },
    onsets: [],
    drops: [],
    waveformPeaksKey: 'peaks/test.json',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

/** 元の作品。方針・歌詞・楽曲・登場人物・ロケーション・テロップ・Shot 2 件（採用・外した Take・ロック・最初のフレーム）。 */
const seed = async () => {
  const source: Project = aProject({
    name: '進め！戦子ちゃん！',
    styleGuide: '和モダンのアニメ調',
    avoid: '文字',
    lyrics: '一行目\n二行目',
    lyricCues: [1, 3],
    instrumental: false,
    budgetUsd: 50,
  })
  const shotA: Shot = aShot(source.id, { code: 'CUT-01', order: 1000, startSec: 0, durationSec: 2, description: '店の前', mood: '気合い' })
  const shotB: Shot = aShot(source.id, { code: 'CUT-02', order: 2000, startSec: 2, durationSec: 2, description: '店内' })
  const takeA1: Take = aTake(shotA, 'a'.repeat(64), { index: 1, costUsd: 0.5, reviewStatus: 'warned', humanVerdict: 'rejected' })
  const takeA2: Take = aTake(shotA, 'b'.repeat(64), { index: 2, costUsd: 0.25, parentTakeId: takeA1.id, regenerationReason: '顔が崩れた' })
  const base = baseAppDeps()
  const deps: ProjectDuplicateRoutesDeps & typeof base = {
    ...base,
    projects: createInMemoryProjectRepository([source]),
    shots: createInMemoryShotRepository([{ ...shotA, selectedTakeId: takeA2.id, status: 'approved', lockedAt: new Date('2026-10-01T00:00:00.000Z') }, shotB]),
    takes: createInMemoryTakeRepository([takeA1, takeA2]),
    shotCharacters: createInMemoryShotCharacterRepository(),
    logger: createLogger('silent'),
  }
  await deps.takes.hide(takeA1.id, new Date())

  const script = await deps.scripts.ensureForProject(source.id)
  await deps.scripts.appendVersion({ scriptId: script.id, content: '開店前の商店街で戦子が奮闘する', authoredBy: 'human' })
  const track = await deps.musicTracks.create({ projectId: source.id, mediaAssetId: newId(MediaAssetId), title: '曲', isMaster: true, offsetSec: 0, volume: 1 })
  await deps.musicAnalyses.create(analysisOf(track.id))
  const character = await deps.characters.create({ workspaceId: source.workspaceId, projectId: source.id, name: 'senko', displayName: '戦子' })
  const look = await deps.looks.create({ characterId: character.id, key: 'BASE', name: '基本', isDefault: true })
  const location = await deps.locations.create({ workspaceId: source.workspaceId, projectId: source.id, name: '店', description: '' })
  await deps.shots.update(shotA.id, { locationId: location.id })
  await deps.shotCharacters.replaceAll(shotA.id, [{ characterId: character.id, lookId: look.id, prominence: 'primary', order: 0 }])
  await deps.shotReferences.create({ shotId: shotA.id, mediaAssetId: newId(MediaAssetId), role: 'start_frame', weight: 1, order: 0, sourceKind: 'manual' })
  const style = await deps.textStyles.create(source.id, { name: '歌詞', style: { size: 0.08 } })
  await deps.timelineClips.create({
    projectId: source.id,
    track: 'TEXT',
    startSec: 1,
    durationSec: 2,
    content: { type: 'text', templateKey: 'plain', params: { text: '一行目', styleId: style.id, lyricLine: 0 } },
  })
  await deps.timelineClips.create({
    projectId: source.id,
    track: 'SFX',
    startSec: 0,
    durationSec: 1,
    content: { type: 'media', mediaAssetId: newId(MediaAssetId), inSec: 0, outSec: 1 },
  })
  await deps.transitions.create({ projectId: source.id, fromShotId: shotA.id, toShotId: shotB.id, type: 'dissolve', durationSec: 0.5 })

  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', projectDuplicateRoutes(deps))
  const duplicate = (items: readonly DuplicationItem[], name = '複製した作品', projectId: string = source.id) =>
    app.request(`/projects/${projectId}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, items }),
    })
  return { deps, source, shotA, shotB, takeA1, takeA2, character, look, location, style, duplicate }
}

const shotsOf = async (deps: Awaited<ReturnType<typeof seed>>['deps'], projectId: string) =>
  (await deps.shots.findByProject(projectId as Project['id'])).sort((a, b) => a.order - b.order)

describe('POST /projects/:id/duplicate（全部）', () => {
  it('選んだものを新しい ID で写し、ファイルは同じものを指し、元は変えない', async () => {
    const f = await seed()

    const res = await f.duplicate([...DUPLICATION_ITEMS])

    expect(res.status).toBe(201)
    const { project, notes } = ((await res.json()) as Ok<Duplicated>).data
    expect(project.id).not.toBe(f.source.id)
    expect(project.name).toBe('複製した作品')
    expect(notes).toEqual([])
    const copied = await f.deps.projects.findById(project.id as Project['id'])
    expect(copied).toMatchObject({
      workspaceId: f.source.workspaceId,
      fps: f.source.fps,
      budgetUsd: 50,
      styleGuide: '和モダンのアニメ調',
      avoid: '文字',
      lyrics: '一行目\n二行目',
      lyricCues: [1, 3],
    })

    // 作品の方針（コンセプト）・楽曲と解析（セクション）
    const script = await f.deps.scripts.findByProject(project.id as Project['id'])
    const version = script?.currentVersionId === null || script === null ? null : await f.deps.scripts.findVersionById(script.currentVersionId)
    expect(version?.content).toBe('開店前の商店街で戦子が奮闘する')
    const [track] = await f.deps.musicTracks.findByProject(project.id as Project['id'])
    expect(track?.mediaAssetId).toBe((await f.deps.musicTracks.findByProject(f.source.id))[0]?.mediaAssetId)
    expect((await f.deps.musicAnalyses.findByTrack(track!.id))?.sections).toEqual([{ start: 0, end: 24, label: 'intro', energy: 0.3 }])

    // Shot・登場人物・ロケーション・最初のフレーム・ロック
    const [a, b] = await shotsOf(f.deps, project.id)
    expect([a?.code, b?.code]).toEqual(['CUT-01', 'CUT-02'])
    expect(a?.id).not.toBe(f.shotA.id)
    expect(a?.description).toBe('店の前')
    expect(a?.lockedAt).not.toBeNull()
    expect(a?.locationId).not.toBeNull()
    expect(a?.locationId).not.toBe(f.location.id)
    const [cast] = await f.deps.shotCharacters.findByShot(a!.id)
    expect(cast?.characterId).not.toBe(f.character.id)
    expect((await f.deps.shotReferences.findByShot(a!.id)).map((r) => r.role)).toEqual(['start_frame'])

    // Take: 番号・外した Take・採用・系譜・レビュー・印・生成の記録
    const takes = await f.deps.takes.findByShot(a!.id, { includeHidden: true })
    expect(takes.map((t) => t.index)).toEqual([1, 2])
    expect((await f.deps.takes.findByShot(a!.id)).map((t) => t.index)).toEqual([2])
    const [t1, t2] = takes
    expect(a?.selectedTakeId).toBe(t2?.id)
    expect(a?.status).toBe('approved')
    expect(t2?.parentTakeId).toBe(t1?.id)
    expect(t1).toMatchObject({ reviewStatus: 'pending', humanVerdict: 'rejected', copiedFromTakeId: f.takeA1.id, mediaAssetId: f.takeA1.mediaAssetId })
    expect(t2?.spec.shotId).toBe(a?.id)
    expect(t2?.specHash).toBe(await computeSpecHash({ ...f.takeA2.spec, shotId: a!.id }))
    expect(b?.status).toBe('draft')

    // テロップ（見た目を付け替え、歌詞との結び付きを残す）・重ね素材・トランジション
    const clips = await f.deps.timelineClips.findByProject(project.id as Project['id'])
    const telop = clips.find((clip) => clip.track === 'TEXT')
    const [copiedStyle] = await f.deps.textStyles.findByProject(project.id as Project['id'])
    expect(telop?.content).toEqual({ type: 'text', templateKey: 'plain', params: { text: '一行目', styleId: copiedStyle?.id, lyricLine: 0 } })
    expect(clips.some((clip) => clip.track === 'SFX')).toBe(true)
    const [transition] = await f.deps.transitions.findByProject(project.id as Project['id'])
    expect(transition).toMatchObject({ fromShotId: a?.id, toShotId: b?.id, type: 'dissolve' })

    // 元は変わらない
    expect((await f.deps.shots.findByProject(f.source.id)).map((s) => s.id).sort()).toEqual([f.shotA.id, f.shotB.id].sort())
    expect(await f.deps.takes.findByShot(f.shotA.id, { includeHidden: true })).toHaveLength(2)
  })
})

describe('POST /projects/:id/duplicate（一部だけ）', () => {
  it('Shot だけなら、登場人物・ロケーションを外して知らせ、絵コンテ・絵・Take は写さない', async () => {
    const f = await seed()

    const res = await f.duplicate(['shots'])

    expect(res.status).toBe(201)
    const { project, notes } = ((await res.json()) as Ok<Duplicated>).data
    expect(notes).toEqual([
      'キャラクターを持っていかなかったので、Shot 1 件の登場人物を外しました',
      'ロケーションを持っていかなかったので、Shot 1 件のロケーションを外しました',
    ])
    const [a] = await shotsOf(f.deps, project.id)
    expect(a).toMatchObject({ description: '', mood: null, locationId: null, selectedTakeId: null, status: 'draft' })
    expect(await f.deps.shotCharacters.findByShot(a!.id)).toEqual([])
    expect(await f.deps.shotReferences.findByShot(a!.id)).toEqual([])
    expect(await f.deps.takes.findByShot(a!.id, { includeHidden: true })).toEqual([])
    expect(await f.deps.characters.findByProject(project.id as Project['id'])).toEqual([])
    const copied = await f.deps.projects.findById(project.id as Project['id'])
    expect(copied).toMatchObject({ styleGuide: '', avoid: '', lyrics: '', lyricCues: [] })
  })

  it('作品の方針を持っていかなければ、テロップの歌詞との結び付きを外して知らせる', async () => {
    const f = await seed()

    const res = await f.duplicate(['telops'])

    const { project, notes } = ((await res.json()) as Ok<Duplicated>).data
    expect(notes).toEqual(['作品の方針を持っていかなかったので、テロップ 1 件の歌詞との結び付きを外しました（文字は残っています）'])
    const clips = await f.deps.timelineClips.findByProject(project.id as Project['id'])
    expect(clips.map((clip) => clip.track)).toEqual(['TEXT'])
  })
})

describe('POST /projects/:id/duplicate（断る）', () => {
  it('依存が欠けた選び方は 422 で、何も作らない', async () => {
    const f = await seed()

    const res = await f.duplicate(['takes'])

    expect(res.status).toBe(422)
    expect(await f.deps.projects.findByWorkspace(f.source.workspaceId)).toHaveLength(1)
  })

  it('元の作品が無ければ 404、名前が空なら 422', async () => {
    const f = await seed()

    expect((await f.duplicate([], 'x', aProject().id)).status).toBe(404)
    expect((await f.duplicate([], '   ')).status).toBe(422)
  })

  it('途中で失敗したら、作りかけの新しい作品を消して 500', async () => {
    const f = await seed()
    const broken = { ...f.deps.takes, create: () => Promise.reject(new Error('書けませんでした')) }
    const app = new OpenAPIHono({ defaultHook: validationHook })
    registerErrorHandlers(app, createLogger('silent'))
    app.route('/', projectDuplicateRoutes({ ...f.deps, takes: broken }))

    const res = await app.request(`/projects/${f.source.id}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '失敗する複製', items: [...DUPLICATION_ITEMS] }),
    })

    expect(res.status).toBe(500)
    const live = await f.deps.projects.findByWorkspace(f.source.workspaceId)
    expect(live.map((project) => project.id)).toEqual([f.source.id])
  })
})
