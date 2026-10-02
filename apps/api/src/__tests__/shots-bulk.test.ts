import { OpenAPIHono } from '@hono/zod-openapi'
import {
  LocationId as LocationIdSchema,
  ShotId as ShotIdSchema,
  createPhase1EmptyContextSource,
  newId,
  type Project,
  type Shot,
  type Take,
  ProviderId,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createProviderRegistry, type VideoModelDescriptor } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  FOREIGN_SHOT_REASON,
  NO_TAKE_REASON,
  SHOT_NOT_FOUND_REASON,
  shotBulkRoutes,
} from '../routes/shots-bulk.js'
import type { EditBatchRecorder } from '../routes/edit-batch-recording.js'
import type { ShotRoutesDeps } from '../routes/shots.js'
import { createRecordingQueue } from './app-deps.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { aProject } from './fixtures.js'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { CHEAP_MODEL, GOOD_MODEL, type ErrorBody, type Ok } from './shot-test-support.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'

type BulkApp = OpenAPIHono

const send = (app: BulkApp, method: 'POST' | 'PATCH', path: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const postJson = (app: BulkApp, path: string, body: unknown) => send(app, 'POST', path, body)
const patchJson = (app: BulkApp, path: string, body: unknown) => send(app, 'PATCH', path, body)

/** 1 秒 $1 の高額モデル。4 秒生成で 1 Shot あたり $4 になる。 */
const PRICEY = testModel({ id: 'test/pricey', costPerSecondUsd: 1 })
/** 4 秒生成で 1 Shot あたり $1.5。実測見積り（Seedance 720p の 5 秒 Take）に合わせた値。 */
const MV_MODEL = testModel({ id: 'test/mv', costPerSecondUsd: 0.375 })
/** 4 秒で $1、8 秒で $2。尺の違いで 1 件だけ要求上限を超えさせるために使う。 */
const BY_DURATION = testModel({ id: 'test/by-duration', costPerSecondUsd: 0.25 })

/** 27 件の Shot。制作者が実際に扱っている件数。 */
const twentySevenShots = (project: Project): readonly Shot[] =>
  Array.from({ length: 27 }, (_, i) =>
    aShot(project.id, { code: `shot_${String(i + 1).padStart(3, '0')}`, order: (i + 1) * 1000 }),
  )

type BulkGenerateData = {
  results: (
    | { shotId: string; ok: true; jobIds: string[]; resolvedModel: string }
    | { shotId: string; ok: false; reason: string }
  )[]
  estimatedTotalUsd: number
  enqueuedCount: number
}
type BulkSelectTakeData = {
  results: (
    | { shotId: string; ok: true; takeId: string; status: string }
    | { shotId: string; ok: false; reason: string }
  )[]
}
type BulkUpdateData = {
  results: (
    | { shotId: string; ok: true; shot: { id: string; mood: string | null; description: string } }
    | { shotId: string; ok: false; reason: string }
  )[]
}

type BulkFixtureOptions = {
  readonly project?: Project
  readonly shots?: readonly Shot[]
  readonly takes?: readonly Take[]
  readonly models?: readonly VideoModelDescriptor[]
  readonly otherProjects?: readonly Project[]
  /** 記録の口を差し替える（作れないときの振る舞いを見るため）。 */
  readonly editBatches?: EditBatchRecorder
}

/**
 * 一括経路だけを載せたアプリ。`app.ts` への配線は Architect が行うため、
 * ここではルートを直接 mount して検証する。
 */
const buildBulkFixture = (options: BulkFixtureOptions = {}) => {
  const project = options.project ?? aProject()
  const shots = createInMemoryShotRepository(options.shots ?? [aShot(project.id)])
  const takes = createInMemoryTakeRepository(options.takes ?? [])
  const generationJobs = createInMemoryGenerationJobRepository()
  const queue = createRecordingQueue()
  const events = createInMemoryProjectEvents()

  const deps: ShotRoutesDeps = {
    shots,
    projects: createInMemoryProjectRepository([project, ...(options.otherProjects ?? [])]),
    takes,
    generationJobs,
    registry: createProviderRegistry([
      createTestVideoProvider(options.models ?? [CHEAP_MODEL, GOOD_MODEL]),
    ]),
    // テストの動画 Provider の id。AUTO はこの中から選ぶ（ADR-0032）。
    videoProvider: () => Promise.resolve(ProviderId.parse('test')),
    context: createPhase1EmptyContextSource(),
    queue,
    events,
    logger: createLogger('silent'),
  }

  const editBatches = createInMemoryEditBatchRepository()
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', shotBulkRoutes({ ...deps, editBatches: options.editBatches ?? editBatches }))

  return { app, project, shots, takes, generationJobs, queue, events, editBatches }
}

const threeShots = (project: Project): readonly Shot[] => [
  aShot(project.id, { code: 'shot_001', order: 1000 }),
  aShot(project.id, { code: 'shot_002', order: 2000 }),
  aShot(project.id, { code: 'shot_003', order: 3000 }),
]

describe('POST /projects/:projectId/shots/bulk/generate', () => {
  it('選んだ Shot をまとめて投入し、1 件ずつの結果を返す', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/cheap',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    expect(json.data.enqueuedCount).toBe(3)
    expect(json.data.results).toHaveLength(3)
    expect(json.data.results.every((r) => r.ok)).toBe(true)
    // 4 秒 × $0.01 × 3 件
    expect(json.data.estimatedTotalUsd).toBeCloseTo(0.12, 6)

    expect(f.generationJobs.snapshot()).toHaveLength(3)
    expect(f.queue.enqueued()).toHaveLength(3)
    expect(f.shots.snapshot().map((s) => s.status)).toEqual([
      'generating',
      'generating',
      'generating',
    ])
    // 投入した Shot ごとに 1 通ずつ流れる（PHASE 5.8b）。詳細は shot-events.test.ts
    expect(f.events.published()).toHaveLength(3)
  })

  it('count の分だけ 1 Shot ずつジョブを作る', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/cheap',
      count: 2,
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    expect(json.data.results.every((r) => r.ok && r.jobIds.length === 2)).toBe(true)
    expect(f.queue.enqueued()).toHaveLength(6)
  })

  /**
   * この経路が存在する理由そのもの。1 件ずつ投入しながら確かめると、
   * 上限に当たった時点で既に投入済みの分が課金される。
   */
  it('合計見積がプロジェクト予算を超えたら 422 で、1 件も投入しない', async () => {
    const project = aProject({ budgetUsd: 5 })
    // 1 件あたり $4。個別には上限内だが、2 件で $8 になり予算 $5 を超える
    const shots = threeShots(project).slice(0, 2)
    const f = buildBulkFixture({ project, shots, models: [PRICEY] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/pricey',
    })

    expect(res.status).toBe(422)
    const body = (await res.json()) as ErrorBody
    expect(body.error).toContain('予算')
    expect(body.fields?.cost).toEqual(['project_budget'])
    expect(body.fields?.estimatedTotalUsd).toEqual(['8.000'])
    expect(body.fields?.limitUsd).toEqual(['5.000'])

    // **1 件も投入されていないこと。** ジョブ行もキューも Shot の状態も動かさない
    expect(f.generationJobs.snapshot()).toHaveLength(0)
    expect(f.queue.enqueued()).toHaveLength(0)
    expect(f.shots.snapshot().every((s) => s.status === 'ready')).toBe(true)
  })

  it('1 件だけなら予算内なので投入される（上の 422 が件数によることの裏取り）', async () => {
    const project = aProject({ budgetUsd: 5 })
    const shots = threeShots(project).slice(0, 2)
    const f = buildBulkFixture({ project, shots, models: [PRICEY] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: [shots[0]?.id],
      model: 'test/pricey',
    })

    expect(res.status).toBe(202)
    expect(f.queue.enqueued()).toHaveLength(1)
  })

  /**
   * `maxCostPerRequestUsd` は「1 Shot への 1 回の依頼」の上限なので、一括の合計には
   * 当てない。合計に当てると 27 件の一括が実 Provider では常に 422 になり、口が使えない。
   */
  it('27 件 × $1.5 は予算 $300 なら全件投入される（要求上限を合計に当てない）', async () => {
    const project = aProject({ budgetUsd: 300 })
    const shots = twentySevenShots(project)
    const f = buildBulkFixture({ project, shots, models: [MV_MODEL] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/mv',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    expect(json.data.results).toHaveLength(27)
    expect(json.data.results.every((r) => r.ok)).toBe(true)
    expect(json.data.enqueuedCount).toBe(27)
    expect(json.data.estimatedTotalUsd).toBeCloseTo(40.5, 6)
    expect(f.queue.enqueued()).toHaveLength(27)
  })

  it('27 件 × $1.5 は予算 $30 なら 422 で、1 件も投入しない', async () => {
    const project = aProject({ budgetUsd: 30 })
    const shots = twentySevenShots(project)
    const f = buildBulkFixture({ project, shots, models: [MV_MODEL] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/mv',
    })

    expect(res.status).toBe(422)
    const body = (await res.json()) as ErrorBody
    expect(body.fields?.cost).toEqual(['project_budget'])
    expect(body.fields?.estimatedTotalUsd).toEqual(['40.500'])
    expect(body.fields?.limitUsd).toEqual(['30.000'])
    expect(f.generationJobs.snapshot()).toHaveLength(0)
    expect(f.queue.enqueued()).toHaveLength(0)
  })

  it('要求上限を超えた 1 件だけ落とし、残りは投入する', async () => {
    const project = aProject({ budgetUsd: 300 })
    // 8 秒生成 × $0.25 × 4 本 = $8 で要求上限 $6 超え。他は 4 秒なので $4
    const long = aShot(project.id, { code: 'shot_001', order: 1000, durationSec: 7 })
    const short = threeShots(project).slice(1)
    const f = buildBulkFixture({
      project,
      shots: [long, ...short],
      models: [BY_DURATION],
    })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: [long.id, ...short.map((s) => s.id)],
      model: 'test/by-duration',
      count: 4,
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    const failed = json.data.results[0]
    expect(failed?.ok).toBe(false)
    expect(failed?.ok === false && failed.reason).toContain('1 回の要求の上限')
    expect(json.data.results.slice(1).every((r) => r.ok)).toBe(true)
    expect(json.data.enqueuedCount).toBe(2)
    expect(f.queue.enqueued()).toHaveLength(8)
  })

  it('Shot の累積上限に当たった 1 件だけ落とし、残りは投入する', async () => {
    const project = aProject()
    const shots = threeShots(project).slice(0, 2)
    const spent = shots[0] as Shot
    const f = buildBulkFixture({
      project,
      shots,
      models: [PRICEY],
      // この Shot は既に $5.5 使っている。$4 を足すと Shot 上限 $6 を超える
      takes: [aTake(spent, 'a'.repeat(64), { costUsd: 5.5 })],
    })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: shots.map((s) => s.id),
      model: 'test/pricey',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    expect(json.data.results[0]?.ok).toBe(false)
    expect(json.data.results[1]?.ok).toBe(true)
    expect(json.data.enqueuedCount).toBe(1)
    expect(f.queue.enqueued()).toHaveLength(1)
  })

  it('他 Project の Shot と存在しない Shot が混ざっても、残りは処理する', async () => {
    const project = aProject()
    const other = aProject()
    const mine = aShot(project.id, { code: 'shot_001', order: 1000 })
    const foreign = aShot(other.id, { code: 'shot_777', order: 7000 })
    const missing = aShot(project.id, { code: 'shot_999', order: 9000 })
    const f = buildBulkFixture({
      project,
      otherProjects: [other],
      shots: [mine, foreign],
    })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: [missing.id, foreign.id, mine.id],
      model: 'test/cheap',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    // 並びは要求どおり。どの Shot が落ちたか画面で対応づけられること
    expect(json.data.results.map((r) => r.shotId)).toEqual([missing.id, foreign.id, mine.id])
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: SHOT_NOT_FOUND_REASON })
    expect(json.data.results[1]).toMatchObject({ ok: false, reason: FOREIGN_SHOT_REASON })
    expect(json.data.results[2]?.ok).toBe(true)
    expect(json.data.enqueuedCount).toBe(1)
    expect(f.queue.enqueued()).toHaveLength(1)
  })

  it('仕様が組めない Shot は理由つきで残し、他は投入する', async () => {
    const project = aProject()
    const ok = aShot(project.id, { code: 'shot_001', order: 1000 })
    // 対応値は 4/6/8 秒。30 秒は切り上げ先が無い（ADR-0011）
    const tooLong = aShot(project.id, { code: 'shot_002', order: 2000, durationSec: 30 })
    const f = buildBulkFixture({ project, shots: [ok, tooLong] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: [ok.id, tooLong.id],
      model: 'test/cheap',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    expect(json.data.results[0]?.ok).toBe(true)
    const failed = json.data.results[1]
    expect(failed?.ok).toBe(false)
    expect(failed?.ok === false && failed.reason.length > 0).toBe(true)
    expect(json.data.enqueuedCount).toBe(1)
  })

  it('モデルの最長より長い Shot は最長で作り、その Shot だけ「尺に合わせる」にする', async () => {
    const project = aProject()
    const fits = aShot(project.id, { code: 'shot_001', order: 1000 })
    // 対応値は 4/6/8 秒。9 秒は 8 秒で作り、ゆっくり再生して埋める
    const long = aShot(project.id, { code: 'shot_002', order: 2000, durationSec: 9 })
    const f = buildBulkFixture({ project, shots: [fits, long] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: [fits.id, long.id],
      model: 'test/cheap',
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as Ok<BulkGenerateData>
    expect(json.data.enqueuedCount).toBe(2)
    expect(f.shots.snapshot().map((s) => s.timing)).toEqual(['trim', 'fit'])
  })

  it('同じ Shot を 2 回指定したら 422', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/generate`, {
      shotIds: [shots[0]?.id, shots[0]?.id],
      model: 'test/cheap',
    })

    expect(res.status).toBe(422)
    expect(f.queue.enqueued()).toHaveLength(0)
  })

  it('shotIds が空なら 422', async () => {
    const f = buildBulkFixture()
    const res = await postJson(f.app, `/projects/${f.project.id}/shots/bulk/generate`, {
      shotIds: [],
      model: 'test/cheap',
    })
    expect(res.status).toBe(422)
  })

  it('存在しない Project は 404', async () => {
    const f = buildBulkFixture()
    const res = await postJson(f.app, `/projects/${aProject().id}/shots/bulk/generate`, {
      shotIds: [f.shots.snapshot()[0]?.id],
      model: 'test/cheap',
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /projects/:projectId/shots/bulk/select-take', () => {
  it('only: Take がちょうど 1 件の Shot だけ採用する', async () => {
    const project = aProject()
    const [one, two, none] = threeShots(project)
    const f = buildBulkFixture({
      project,
      shots: [one as Shot, two as Shot, none as Shot],
      takes: [
        aTake(one as Shot, 'a'.repeat(64), { index: 1 }),
        aTake(two as Shot, 'b'.repeat(64), { index: 1 }),
        aTake(two as Shot, 'c'.repeat(64), { index: 2 }),
      ],
    })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [one?.id, two?.id, none?.id],
      rule: 'only',
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<BulkSelectTakeData>

    expect(json.data.results[0]).toMatchObject({ ok: true, status: 'approved' })
    // 2 件あるものは勝手に選ばない。何件あるか理由に出す
    expect(json.data.results[1]).toMatchObject({ ok: false })
    const ambiguous = json.data.results[1]
    expect(ambiguous?.ok === false && ambiguous.reason).toContain('2 件')
    expect(json.data.results[2]).toMatchObject({ ok: false, reason: NO_TAKE_REASON })

    const stored = f.shots.snapshot()
    expect(stored[0]?.selectedTakeId).not.toBeNull()
    expect(stored[1]?.selectedTakeId).toBeNull()
    expect(stored[2]?.selectedTakeId).toBeNull()
  })

  it('人が承認済みの Take を採用したら approved になる（1 件ずつの採用と同じ判断）', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const f = buildBulkFixture({
      project,
      shots: [shot],
      takes: [aTake(shot, 'a'.repeat(64), { humanVerdict: 'approved' })],
    })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [shot.id],
      rule: 'only',
    })

    const json = (await res.json()) as Ok<BulkSelectTakeData>
    expect(json.data.results[0]).toMatchObject({ ok: true, status: 'approved' })
  })

  it('latest: index ではなく createdAt が最新の Take を採用する', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    // index の並びと createdAt の並びをわざと逆にする。index で選んでいたら落ちる
    const newest = aTake(shot, 'a'.repeat(64), {
      index: 1,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    })
    const oldest = aTake(shot, 'b'.repeat(64), {
      index: 2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const f = buildBulkFixture({ project, shots: [shot], takes: [oldest, newest] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [shot.id],
      rule: 'latest',
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<BulkSelectTakeData>
    expect(json.data.results[0]).toMatchObject({ ok: true, takeId: newest.id })
    expect(f.shots.snapshot()[0]?.selectedTakeId).toBe(newest.id)
  })

  it('latest: Take が 1 件も無ければ理由つきで残す', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const f = buildBulkFixture({ project, shots: [shot] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [shot.id],
      rule: 'latest',
    })

    const json = (await res.json()) as Ok<BulkSelectTakeData>
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: NO_TAKE_REASON })
  })

  it('他 Project の Shot はその件だけ落とし、残りは採用する', async () => {
    const project = aProject()
    const other = aProject()
    const mine = aShot(project.id, { code: 'shot_001', order: 1000 })
    const foreign = aShot(other.id, { code: 'shot_777', order: 7000 })
    const f = buildBulkFixture({
      project,
      otherProjects: [other],
      shots: [mine, foreign],
      takes: [aTake(mine, 'a'.repeat(64)), aTake(foreign, 'b'.repeat(64))],
    })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [foreign.id, mine.id],
      rule: 'latest',
    })

    const json = (await res.json()) as Ok<BulkSelectTakeData>
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: FOREIGN_SHOT_REASON })
    expect(json.data.results[1]).toMatchObject({ ok: true })
    // 他 Project の Shot は触っていない
    expect(f.shots.snapshot().find((s) => s.id === foreign.id)?.selectedTakeId).toBeNull()
  })
})

describe('PATCH /projects/:projectId/shots/bulk', () => {
  it('共通の項目をまとめて変え、1 件ずつの結果を返す', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const locationId = newId(LocationIdSchema)
    const f = buildBulkFixture({ project, shots })

    const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, {
        shotIds: shots.map((s) => s.id),
        patch: { mood: 'calm', description: '夕暮れのステージ', locationId },
      })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<BulkUpdateData>
    expect(json.data.results).toHaveLength(3)
    expect(json.data.results.every((r) => r.ok)).toBe(true)
    expect(f.shots.snapshot().map((s) => s.mood)).toEqual(['calm', 'calm', 'calm'])
    expect(f.shots.snapshot().every((s) => s.locationId === locationId)).toBe(true)
  })

  /**
   * 「景別だけ変える」で camera 全体を置き換えると、Shot ごとに持っていた
   * lensMm や angle が 27 件まとめて消える。送られた項目だけを重ねること。
   */
  it('camera は Shot ごとに既存の値へ重ねる（送っていない項目は消さない）', async () => {
    const project = aProject()
    const wide = aShot(project.id, { code: 'shot_001', order: 1000 })
    const tele = aShot(project.id, {
      code: 'shot_002',
      order: 2000,
      camera: { ...wide.camera, lensMm: 85, angle: 'low', movement: 'orbit' },
    })
    const f = buildBulkFixture({ project, shots: [wide, tele] })

    const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [wide.id, tele.id],
      patch: { camera: { size: 'closeup' } },
    })

    expect(res.status).toBe(200)
    const stored = f.shots.snapshot()
    expect(stored.map((s) => s.camera.size)).toEqual(['closeup', 'closeup'])
    // 各 Shot が持っていた値はそのまま残る
    expect(stored[0]?.camera.lensMm).toBe(35)
    expect(stored[0]?.camera.angle).toBe('eye')
    expect(stored[1]?.camera.lensMm).toBe(85)
    expect(stored[1]?.camera.angle).toBe('low')
    expect(stored[1]?.camera.movement).toBe('orbit')
  })

  it('camera の項目に null を送れば、その項目だけ外せる', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const f = buildBulkFixture({ project, shots: [shot] })

    const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [shot.id],
      patch: { camera: { lensMm: null } },
    })

    expect(res.status).toBe(200)
    expect(f.shots.snapshot()[0]?.camera.lensMm).toBeNull()
    expect(f.shots.snapshot()[0]?.camera.size).toBe(shot.camera.size)
  })

  it('camera の知らない項目と空の camera は 422', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const f = buildBulkFixture({ project, shots: [shot] })

    for (const patch of [{ camera: { zoom: 3 } }, { camera: {} }]) {
      const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, {
        shotIds: [shot.id],
        patch,
      })
      expect(res.status).toBe(422)
    }
  })

  /** 時間を一括で動かす口は作らない。重なりだらけのタイムラインを 1 回で作れてしまう。 */
  it('startSec を送ったら 422 で、何も変えない', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })

    const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, { shotIds: shots.map((s) => s.id), patch: { startSec: 12 } })

    expect(res.status).toBe(422)
    expect(f.shots.snapshot().every((s) => s.startSec === 0)).toBe(true)
  })

  it('order や code も受け付けない', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })

    for (const patch of [{ order: 10 }, { code: 'shot_zzz' }, { durationSec: 8 }]) {
      const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, { shotIds: shots.map((s) => s.id), patch })
      expect(res.status).toBe(422)
    }
  })

  it('空の patch は 422', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })

    const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, { shotIds: shots.map((s) => s.id), patch: {} })

    expect(res.status).toBe(422)
  })

  it('存在しない Shot はその件だけ落とし、残りは更新する', async () => {
    const project = aProject()
    const mine = aShot(project.id, { code: 'shot_001', order: 1000 })
    const missing = aShot(project.id, { code: 'shot_999', order: 9000 })
    const f = buildBulkFixture({ project, shots: [mine] })

    const res = await patchJson(f.app, `/projects/${project.id}/shots/bulk`, { shotIds: [missing.id, mine.id], patch: { mood: 'calm' } })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<BulkUpdateData>
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: SHOT_NOT_FOUND_REASON })
    expect(json.data.results[1]).toMatchObject({ ok: true })
    expect(f.shots.snapshot()[0]?.mood).toBe('calm')
  })
})

/**
 * 一括変更の記録（P64-1）。**書く直前に「変える前」を残す。**
 * 最大 200 件が一度に変わるので、記録が無いと戻せない。
 */
describe('一括変更は「変える前」を記録する', () => {
  it('変わる欄だけを、Shot ごとに残す', async () => {
    const project = aProject()
    const shot = aShot(project.id, { mood: '元の雰囲気', description: '元の説明' })
    const { app, editBatches } = buildBulkFixture({ project, shots: [shot] })

    const res = await patchJson(app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [shot.id],
      patch: { mood: '新しい雰囲気' },
    })

    expect(res.status).toBe(200)
    const [batch] = editBatches.snapshot()
    expect(batch?.kind).toBe('bulk_update')
    expect(batch?.entries).toEqual([{ shotId: shot.id, patch: { mood: '元の雰囲気' } }])
    expect(batch?.entries[0] && 'selectedTakeId' in batch.entries[0]).toBe(false)
  })

  it('camera は重ねた結果と比べ、変わる項目だけを残す', async () => {
    const project = aProject()
    // 既定の camera は size: medium / lensMm: 35。size だけを変える。
    const shot = aShot(project.id)
    const { app, editBatches } = buildBulkFixture({ project, shots: [shot] })

    await patchJson(app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [shot.id],
      patch: { camera: { size: 'closeup' } },
    })

    const [batch] = editBatches.snapshot()
    // **全欄ではなく camera 1 欄。** ただし中身は重ねる前の camera そのもの。
    expect(Object.keys(batch?.entries[0]?.patch ?? {})).toEqual(['camera'])
    expect(batch?.entries[0]?.patch.camera).toEqual(shot.camera)
  })

  it('同じ値を送った Shot は記録に入れない', async () => {
    const project = aProject()
    const same = aShot(project.id, { code: 'S1', order: 1000, mood: '同じ雰囲気' })
    const other = aShot(project.id, { code: 'S2', order: 2000, mood: '違う雰囲気' })
    const { app, editBatches } = buildBulkFixture({ project, shots: [same, other] })

    await patchJson(app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [same.id, other.id],
      patch: { mood: '同じ雰囲気' },
    })

    const [batch] = editBatches.snapshot()
    expect(batch?.entries).toEqual([{ shotId: other.id, patch: { mood: '違う雰囲気' } }])
    expect(batch?.summary).toContain('1 件')
  })

  it('1 件も変わらなければ記録そのものを作らない', async () => {
    const project = aProject()
    const shot = aShot(project.id, { mood: '同じ雰囲気' })
    const { app, editBatches } = buildBulkFixture({ project, shots: [shot] })

    const res = await patchJson(app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [shot.id],
      patch: { mood: '同じ雰囲気' },
    })

    expect(res.status).toBe(200)
    expect(editBatches.snapshot()).toEqual([])
  })

  it('記録を作れなければ Shot を 1 件も書かない', async () => {
    const project = aProject()
    const shot = aShot(project.id, { mood: '元の雰囲気' })
    const { app, shots } = buildBulkFixture({
      project,
      shots: [shot],
      editBatches: { create: () => Promise.reject(new Error('記録を作れませんでした')) },
    })

    const res = await patchJson(app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [shot.id],
      patch: { mood: '新しい雰囲気' },
    })

    expect(res.status).toBe(500)
    expect(shots.snapshot()[0]?.mood).toBe('元の雰囲気')
  })

  it('当てられなかった Shot は記録に入れない', async () => {
    const project = aProject()
    const missing = newId(ShotIdSchema)
    const shot = aShot(project.id, { mood: '元の雰囲気' })
    const { app, editBatches } = buildBulkFixture({ project, shots: [shot] })

    await patchJson(app, `/projects/${project.id}/shots/bulk`, {
      shotIds: [missing, shot.id],
      patch: { mood: '新しい雰囲気' },
    })

    const [batch] = editBatches.snapshot()
    expect(batch?.entries.map((entry) => entry.shotId)).toEqual([shot.id])
  })
})

/**
 * 一括採用の記録（P64-1）。
 *
 * **採用 Take と状態の両方を控える。** `applySelectedTake` は 2 つを動かすので、
 * 片方だけ控えると、取り消しても状態が新しいまま残る。
 */
describe('一括採用は「変える前」を記録する', () => {
  const sceneWithTake = (overrides: Partial<Shot> = {}) => {
    const project = aProject()
    const shot = aShot(project.id, { status: 'ready', selectedTakeId: null, ...overrides })
    const take = aTake(shot, 'a'.repeat(64))
    return { project, shot, take }
  }

  it('採用前の selectedTakeId と status の両方を残す', async () => {
    const { project, shot, take } = sceneWithTake()
    const { app, editBatches } = buildBulkFixture({ project, shots: [shot], takes: [take] })

    const res = await postJson(app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [shot.id],
      rule: 'only',
    })

    expect(res.status).toBe(200)
    const [batch] = editBatches.snapshot()
    expect(batch?.kind).toBe('bulk_update')
    expect(batch?.entries).toEqual([
      // **`null` は「採用していなかった」。** 欄が無いのは「触っていない」。
      { shotId: shot.id, patch: {}, selectedTakeId: null, status: 'ready' },
    ])
  })

  it('採用済みの Shot でも、そのときの採用 Take を残す', async () => {
    const project = aProject()
    const bare = aShot(project.id, { status: 'review' })
    const first = aTake(bare, 'a'.repeat(64), { index: 1 })
    const second = aTake(bare, 'b'.repeat(64), {
      index: 2,
      createdAt: new Date('2026-03-01T00:00:00Z'),
    })
    const shot = { ...bare, selectedTakeId: first.id }
    const { app, editBatches } = buildBulkFixture({
      project,
      shots: [shot],
      takes: [first, second],
    })

    await postJson(app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [shot.id],
      rule: 'latest',
    })

    const [batch] = editBatches.snapshot()
    expect(batch?.entries[0]?.selectedTakeId).toBe(first.id)
    expect(batch?.entries[0]?.status).toBe('review')
  })

  it('採用できなかった Shot は記録に入れない', async () => {
    const project = aProject()
    const withTake = aShot(project.id, { code: 'S1', order: 1000, status: 'ready' })
    const take = aTake(withTake, 'a'.repeat(64))
    const withoutTake = aShot(project.id, { code: 'S2', order: 2000, status: 'ready' })
    const { app, editBatches } = buildBulkFixture({
      project,
      shots: [withTake, withoutTake],
      takes: [take],
    })

    await postJson(app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [withoutTake.id, withTake.id],
      rule: 'only',
    })

    const [batch] = editBatches.snapshot()
    expect(batch?.entries.map((entry) => entry.shotId)).toEqual([withTake.id])
  })

  it('1 件も採用できなければ記録そのものを作らない', async () => {
    const project = aProject()
    const withoutTake = aShot(project.id, { status: 'ready' })
    const { app, editBatches } = buildBulkFixture({ project, shots: [withoutTake] })

    const res = await postJson(app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [withoutTake.id],
      rule: 'only',
    })

    expect(res.status).toBe(200)
    expect(editBatches.snapshot()).toEqual([])
  })

  /** **記録は書き込みの「直前」に作る。** 作れなかったなら 1 件も採用しない。 */
  it('記録を作れなければ 1 件も採用しない', async () => {
    const { project, shot, take } = sceneWithTake()
    const { app, shots } = buildBulkFixture({
      project,
      shots: [shot],
      takes: [take],
      editBatches: { create: () => Promise.reject(new Error('記録を作れませんでした')) },
    })

    const res = await postJson(app, `/projects/${project.id}/shots/bulk/select-take`, {
      shotIds: [shot.id],
      rule: 'only',
    })

    expect(res.status).toBe(500)
    expect(shots.snapshot()[0]?.selectedTakeId).toBeNull()
    expect(shots.snapshot()[0]?.status).toBe('ready')
  })
})

/**
 * チェックした Shot をまとめて消す（制作者の要望 2026-09-26）。
 *
 * 以前はメニュー「Shot」→「選択を削除」で、いま選んでいる 1 件しか消せなかった。
 * 区切りから Shot を作り直したいときに、1 件ずつ選んで消すことになる。
 */
describe('POST /projects/:projectId/shots/bulk/delete', () => {
  type BulkDeleteData = {
    results: ({ shotId: string; ok: true } | { shotId: string; ok: false; reason: string })[]
    deletedCount: number
  }

  it('選んだ Shot をまとめて消し、1 件ずつの結果を返す', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/delete`, {
      shotIds: [shots[0]?.id, shots[2]?.id],
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Ok<BulkDeleteData>
    expect(body.data.deletedCount).toBe(2)
    expect(body.data.results.every((r) => r.ok)).toBe(true)
    const left = await f.shots.findByProject(project.id)
    expect(left.map((s) => s.code)).toEqual(['shot_002'])
  })

  it('別の Project の Shot は消さず、理由を返す', async () => {
    const project = aProject()
    const other = aProject()
    const foreign = aShot(other.id, { code: 'other_001' })
    const f = buildBulkFixture({ project, shots: [...threeShots(project), foreign], otherProjects: [other] })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/delete`, {
      shotIds: [foreign.id],
    })

    const body = (await res.json()) as Ok<BulkDeleteData>
    expect(body.data.deletedCount).toBe(0)
    expect(body.data.results[0]).toEqual({ shotId: foreign.id, ok: false, reason: FOREIGN_SHOT_REASON })
    expect(await f.shots.findById(foreign.id)).not.toBeNull()
  })

  it('見つからない Shot は理由を返し、他は消す', async () => {
    const project = aProject()
    const shots = threeShots(project)
    const f = buildBulkFixture({ project, shots })
    const missing = newId(ShotIdSchema)

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/delete`, {
      shotIds: [missing, shots[1]?.id],
    })

    const body = (await res.json()) as Ok<BulkDeleteData>
    expect(body.data.deletedCount).toBe(1)
    expect(body.data.results[0]).toEqual({ shotId: missing, ok: false, reason: SHOT_NOT_FOUND_REASON })
  })

  it('Project が無ければ 404', async () => {
    const f = buildBulkFixture()

    const res = await postJson(f.app, `/projects/${aProject().id}/shots/bulk/delete`, {
      shotIds: [newId(ShotIdSchema)],
    })

    expect(res.status).toBe(404)
  })

  it('空の指定は 422（何も消さない操作を成功にしない）', async () => {
    const project = aProject()
    const f = buildBulkFixture({ project })

    const res = await postJson(f.app, `/projects/${project.id}/shots/bulk/delete`, { shotIds: [] })

    expect(res.status).toBe(422)
  })
})
