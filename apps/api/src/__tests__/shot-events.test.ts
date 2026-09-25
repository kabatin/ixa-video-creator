import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ProjectEvent,
  createPhase1EmptyContextSource,
  type Project,
  type ProjectEventPublisher,
  type Shot,
  type Take,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import type { ShotRoutesDeps } from '../routes/shots.js'
import { shotRoutes } from '../routes/shots.js'
import { shotBulkRoutes } from '../routes/shots-bulk.js'
import { createRecordingQueue } from './app-deps.js'
import { aProject } from './fixtures.js'
import {
  createFailingProjectEventPublisher,
  createInMemoryProjectEvents,
} from './in-memory-project-events.js'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { CHEAP_MODEL, GOOD_MODEL, type Ok } from './shot-test-support.js'
import { createTestVideoProvider } from './test-video-provider.js'

/**
 * API が状態を変えた瞬間に出来事を流しているか（tasks/todo.md PHASE 5.8b）。
 *
 * `app.ts` への配線は Architect が行うため、ここでは 1 件ずつの経路と一括の経路を
 * 直接 mount して検証する（`shots-bulk.test.ts` と同じやり方）。
 */

type FixtureOptions = {
  readonly project?: Project
  readonly shots?: readonly Shot[]
  readonly takes?: readonly Take[]
  /** 差し替えると publish が必ず失敗する。**失敗しても本処理が通る**ことの確認に使う。 */
  readonly events?: ProjectEventPublisher
}

const buildFixture = (options: FixtureOptions = {}) => {
  const project = options.project ?? aProject()
  const events = createInMemoryProjectEvents()
  const shots = createInMemoryShotRepository(options.shots ?? [aShot(project.id)])
  const deps: ShotRoutesDeps = {
    shots,
    projects: createInMemoryProjectRepository([project]),
    takes: createInMemoryTakeRepository(options.takes ?? []),
    generationJobs: createInMemoryGenerationJobRepository(),
    registry: createProviderRegistry([createTestVideoProvider([CHEAP_MODEL, GOOD_MODEL])]),
    context: createPhase1EmptyContextSource(),
    queue: createRecordingQueue(),
    events: options.events ?? events,
    logger: createLogger('silent'),
  }

  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', shotRoutes(deps))
  app.route('/', shotBulkRoutes({ ...deps, editBatches: createInMemoryEditBatchRepository() }))

  return { app, project, events, shots }
}

const postJson = (app: OpenAPIHono, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const threeShots = (project: Project): readonly Shot[] => [
  aShot(project.id, { code: 'shot_001', order: 1000 }),
  aShot(project.id, { code: 'shot_002', order: 2000 }),
  aShot(project.id, { code: 'shot_003', order: 3000 }),
]

/** 流れた出来事が domain の契約を通ること。形が崩れたら画面が読めない。 */
const parsedEvents = (published: readonly unknown[]) => published.map((e) => ProjectEvent.parse(e))

describe('生成の投入で shot.status を流す', () => {
  it('1 件ずつの生成: generating を 1 通流す', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const f = buildFixture({ project, shots: [shot] })

    const res = await postJson(f.app, `/shots/${shot.id}/generate`, { model: 'test/cheap' })

    expect(res.status).toBe(202)
    const [event, ...rest] = parsedEvents(f.events.published())
    expect(rest).toHaveLength(0)
    expect(event).toMatchObject({
      type: 'shot.status',
      projectId: project.id,
      shotId: shot.id,
      status: 'generating',
    })
  })

  it('一括生成: 投入した Shot ごとに 1 通ずつ流す', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildFixture({ project, shots })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/cheap',
    })

    expect(res.status).toBe(202)
    const events = parsedEvents(f.events.published())
    expect(events).toHaveLength(3)
    expect(events.map((e) => ('shotId' in e ? e.shotId : null))).toEqual(shots.map((s) => s.id))
    expect(events.every((e) => e.type === 'shot.status' && e.status === 'generating')).toBe(true)
  })

  it('投入されなかった Shot の分は流さない', async () => {
    // 上限を下回れないので 1 件も投入されない（結果は 1 件ずつ理由付きで返る）
    const project = aProject({ budgetUsd: 0.001 })
    const shots = threeShots(project)
    const f = buildFixture({ project, shots })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/cheap',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<{ enqueuedCount: number }>
    expect(json.data.enqueuedCount).toBe(0)
    expect(f.events.published()).toHaveLength(0)
  })
})

describe('Take の採用で shot.status を流す', () => {
  it('1 件ずつの採用: 遷移後の status を流す', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const take = aTake(shot, 'a'.repeat(64))
    const f = buildFixture({ project, shots: [shot], takes: [take] })

    const res = await postJson(f.app, `/shots/${shot.id}/select-take`, { takeId: take.id })

    expect(res.status).toBe(200)
    const [event] = parsedEvents(f.events.published())
    expect(event).toMatchObject({
      type: 'shot.status',
      projectId: project.id,
      shotId: shot.id,
      // 採用が決定（ADR-0023）。
      status: 'approved',
    })
  })

  it('人が承認済みの Take なら approved を流す（遷移した先をそのまま流す）', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const take = aTake(shot, 'a'.repeat(64), { humanVerdict: 'approved' })
    const f = buildFixture({ project, shots: [shot], takes: [take] })

    const res = await postJson(f.app, `/shots/${shot.id}/select-take`, { takeId: take.id })

    expect(res.status).toBe(200)
    const [event] = parsedEvents(f.events.published())
    expect(event).toMatchObject({ status: 'approved', shotId: shot.id })
  })

  it('一括採用: 採用した Shot ごとに 1 通ずつ流す', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const takes = shots.map((shot, i) => aTake(shot, String(i).repeat(64)))
    const f = buildFixture({ project, shots, takes })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: shots.map((s) => s.id),
      rule: 'only',
    })

    expect(res.status).toBe(200)
    const events = parsedEvents(f.events.published())
    expect(events).toHaveLength(3)
    expect(events.map((e) => ('shotId' in e ? e.shotId : null))).toEqual(shots.map((s) => s.id))
    expect(events.every((e) => e.type === 'shot.status' && e.status === 'approved')).toBe(true)
  })

  it('採用できなかった Shot の分は流さない', async () => {
    const project = aProject()
    const shots = threeShots(project)
    // Take があるのは 1 件だけ。残り 2 件は「Take がまだありません」で落ちる
    const f = buildFixture({
      project,
      shots,
      takes: [aTake(shots[0] as Shot, 'a'.repeat(64))],
    })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: shots.map((s) => s.id),
      rule: 'only',
    })

    expect(res.status).toBe(200)
    expect(parsedEvents(f.events.published())).toHaveLength(1)
  })
})

/**
 * **通知は状態変更への上乗せ。** 配信が落ちても、投入や採用を巻き戻さない
 * （domain の `ProjectEventPublisher` の約束）。
 */
describe('publish が失敗しても本処理は止まらない', () => {
  it('生成の投入: publish が reject しても 202 を返し、状態も進む', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const failing = createFailingProjectEventPublisher()
    const f = buildFixture({ project, shots: [shot], events: failing })

    const res = await postJson(f.app, `/shots/${shot.id}/generate`, { model: 'test/cheap' })

    expect(res.status).toBe(202)
    expect(failing.attempts()).toBe(1)
    expect(f.shots.snapshot()[0]?.status).toBe('generating')
  })

  it('Take の採用: publish が reject しても 200 を返し、採用は残る', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const take = aTake(shot, 'a'.repeat(64))
    const failing = createFailingProjectEventPublisher()
    const f = buildFixture({ project, shots: [shot], takes: [take], events: failing })

    const res = await postJson(f.app, `/shots/${shot.id}/select-take`, { takeId: take.id })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<{ selectedTakeId: string; status: string }>
    expect(json.data.selectedTakeId).toBe(take.id)
    expect(json.data.status).toBe('approved')
    expect(failing.attempts()).toBe(1)
  })

  it('一括生成: publish が全件 reject しても 202 を返し、全件投入される', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const failing = createFailingProjectEventPublisher()
    const f = buildFixture({ project, shots, events: failing })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/cheap',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<{ enqueuedCount: number }>
    expect(json.data.enqueuedCount).toBe(3)
    expect(failing.attempts()).toBe(3)
  })
})
