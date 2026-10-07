import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ProviderId,
  REMAKE_FINAL_REASON,
  createPhase1EmptyContextSource,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryLocationRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createProviderRegistry, type VideoModelDescriptor } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  ALREADY_FINAL_REASON,
  ALREADY_REMADE_REASON,
  ALREADY_RUNNING_REASON,
  NO_FINAL_TIER_REASON,
  NO_SELECTED_TAKE_REASON,
  shotBulkFinalRoutes,
} from '../routes/shots-bulk-final.js'
import { FOREIGN_SHOT_REASON } from '../routes/shots-bulk-plan.js'
import type { ShotRoutesDeps } from '../routes/shots.js'
import { createRecordingQueue } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'

/**
 * まとめて本番で作り直す（ADR-0042 段 4 / 資料 3.4「夜間の一括生成」）。
 *
 * **仕様は変えず、段だけ `final` にする。** 同じシード・同じ親で積む。
 * 飛ばした Shot は理由つきで返す（件数だけに畳まない。L-015）。
 */

/** 試作と本番。**同じ Provider**（別 Provider の本番に逃がさないことを見るため）。 */
const DRAFT: VideoModelDescriptor = {
  ...testModel({ id: 'test/draft', costPerSecondUsd: 0, typicalLatencySec: 100 }),
  qualityTier: 'draft',
}
const FINAL: VideoModelDescriptor = {
  ...testModel({ id: 'test/final', costPerSecondUsd: 0, typicalLatencySec: 400 }),
  qualityTier: 'final',
  /**
   * **尺 1 秒あたりの時間を持つ**（手元の GPU で作るモデルと同じ形）。
   * これが無いと `estimateLatencySec` は一律の目安を返し、尺に比例しているかを確かめられない。
   */
  economics: {
    ...testModel({ id: 'test/final', costPerSecondUsd: 0, typicalLatencySec: 400 }).economics,
    latencySecPerOutputSec: 50,
  },
}
/** 段を持たない AI。ここで採用していると「本番の段がありません」。 */
const PLAIN: VideoModelDescriptor = testModel({ id: 'test/plain', costPerSecondUsd: 0 })

type FixtureOptions = {
  readonly project?: Project
  readonly shots?: readonly Shot[]
  readonly takes?: readonly Take[]
  readonly models?: readonly VideoModelDescriptor[]
  readonly otherProjects?: readonly Project[]
}

const buildFixture = (options: FixtureOptions = {}) => {
  const project = options.project ?? aProject()
  const shots = createInMemoryShotRepository(options.shots ?? [])
  const takes = createInMemoryTakeRepository(options.takes ?? [])
  const generationJobs = createInMemoryGenerationJobRepository()
  const queue = createRecordingQueue()

  const deps: ShotRoutesDeps = {
    shots,
    projects: createInMemoryProjectRepository([project, ...(options.otherProjects ?? [])]),
    locations: createInMemoryLocationRepository(),
    takes,
    generationJobs,
    registry: createProviderRegistry([
      createTestVideoProvider(options.models ?? [DRAFT, FINAL, PLAIN]),
    ]),
    videoProvider: () => Promise.resolve(ProviderId.parse('test')),
    context: createPhase1EmptyContextSource(),
    queue,
    events: createInMemoryProjectEvents(),
    logger: createLogger('silent'),
  }

  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', shotBulkFinalRoutes(deps))
  return { app, project, shots, takes, generationJobs, queue }
}

type RemakeData = {
  results: (
    | { shotId: string; ok: true; jobIds: string[]; resolvedModel: string; estimatedLatencySec: number }
    | { shotId: string; ok: false; reason: string }
  )[]
  enqueuedCount: number
  estimatedTotalUsd: number
  estimatedTotalLatencySec: number
  dryRun: boolean
}

const post = (app: OpenAPIHono, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** 試作を採用済みの Shot。 */
const adoptedDraft = (project: Project, overrides: Partial<Take> = {}) => {
  const shot = aShot(project.id, { code: 'CUT-38', durationSec: 4, status: 'approved' })
  const take = aTake(shot, 'a'.repeat(64), {
    modelId: DRAFT.id,
    seedUsed: 917318685,
    ...overrides,
  })
  return { shot: { ...shot, selectedTakeId: take.id } as Shot, take }
}

describe('POST /projects/:projectId/shots/bulk/remake-final', () => {
  it('採用 Take と同じシード・同じ親で、本番のモデルを積む', async () => {
    const project = aProject()
    const { shot, take } = adoptedDraft(project)
    const f = buildFixture({ project, shots: [shot], takes: [take] })

    const res = await post(f.app, `/projects/${project.id}/shots/bulk/remake-final`, {
      shotIds: [shot.id],
    })

    expect(res.status).toBe(202)
    const json = (await res.json()) as { data: RemakeData }
    expect(json.data.results[0]).toMatchObject({ ok: true, resolvedModel: FINAL.id })
    expect(json.data.enqueuedCount).toBe(1)

    const [job] = f.generationJobs.snapshot()
    expect(job?.resolvedModel).toBe(FINAL.id)
    // **行に積まないと worker が同じ仕様を組み直せない**（L-012 / seed は 2026-10-07 に落ちた）
    expect(job?.seed).toBe(917318685)
    expect(job?.parentTakeId).toBe(take.id)
    expect(job?.regenerationReason).toBe(REMAKE_FINAL_REASON)
  })

  /** 「作り直す必要が無い」を押させない。押すと同じ画質の Take が 1 本増えるだけ。 */
  it('採用中が既に本番なら飛ばす', async () => {
    const project = aProject()
    const { shot, take } = adoptedDraft(project, { modelId: FINAL.id })
    const f = buildFixture({ project, shots: [shot], takes: [take] })

    const res = await post(f.app, `/projects/${project.id}/shots/bulk/remake-final`, {
      shotIds: [shot.id],
    })

    const json = (await res.json()) as { data: RemakeData }
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: ALREADY_FINAL_REASON })
    expect(f.generationJobs.snapshot()).toEqual([])
  })

  it('採用していない Shot・本番の段が無い AI・他 Project の Shot は、理由つきで飛ばす', async () => {
    const project = aProject()
    const other = aProject()
    const { shot: ok, take } = adoptedDraft(project)
    const notAdopted = aShot(project.id, { code: 'CUT-01', order: 1000 })
    const plainShot = aShot(project.id, { code: 'CUT-02', order: 2000 })
    const plainTake = aTake(plainShot, 'b'.repeat(64), { modelId: PLAIN.id })
    const foreign = aShot(other.id, { code: 'CUT-99', order: 9000 })

    const f = buildFixture({
      project,
      otherProjects: [other],
      shots: [ok, notAdopted, { ...plainShot, selectedTakeId: plainTake.id }, foreign],
      takes: [take, plainTake],
    })

    const res = await post(f.app, `/projects/${project.id}/shots/bulk/remake-final`, {
      shotIds: [notAdopted.id, plainShot.id, foreign.id, ok.id],
    })

    const json = (await res.json()) as { data: RemakeData }
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: NO_SELECTED_TAKE_REASON })
    expect(json.data.results[1]).toMatchObject({ ok: false, reason: NO_FINAL_TIER_REASON })
    expect(json.data.results[2]).toMatchObject({ ok: false, reason: FOREIGN_SHOT_REASON })
    expect(json.data.results[3]).toMatchObject({ ok: true })
    expect(json.data.enqueuedCount).toBe(1)
  })

  /**
   * **夜に積む操作なので、同じ選択で 2 回押されうる。**
   * 2 回目は 1 件も積まない（同じ仕様を作っている最中）。
   */
  it('二度押しで二重に積まない', async () => {
    const project = aProject()
    const { shot, take } = adoptedDraft(project)
    const f = buildFixture({ project, shots: [shot], takes: [take] })
    const path = `/projects/${project.id}/shots/bulk/remake-final`

    await post(f.app, path, { shotIds: [shot.id] })
    const again = await post(f.app, path, { shotIds: [shot.id] })

    const json = (await again.json()) as { data: RemakeData }
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: ALREADY_RUNNING_REASON })
    expect(f.generationJobs.snapshot()).toHaveLength(1)
  })

  /** 一度できあがったものを、翌日もう一度積まない。 */
  it('同じ仕様の本番 Take が既にあれば飛ばす', async () => {
    const project = aProject()
    const { shot, take } = adoptedDraft(project)
    const f = buildFixture({ project, shots: [shot], takes: [take] })
    const path = `/projects/${project.id}/shots/bulk/remake-final`

    // 1 回積んで仕様を確定させ、その仕様で「できあがった」状態を作る
    await post(f.app, path, { shotIds: [shot.id] })
    const job = f.generationJobs.snapshot()[0]
    expect(job).toBeDefined()
    await f.takes.create(aTake(shot, job?.specHash as string, { modelId: FINAL.id, index: 2 }))
    // **作っている最中ではなく「もうある」で断られること**を見たいので、ジョブは終わらせる
    await f.generationJobs.update(job?.id as (typeof job & object)['id'], { status: 'succeeded' })

    const res = await post(f.app, path, { shotIds: [shot.id] })
    const json = (await res.json()) as { data: RemakeData }
    expect(json.data.results[0]).toMatchObject({ ok: false, reason: ALREADY_REMADE_REASON })
    expect(f.generationJobs.snapshot()).toHaveLength(1)
  })

  /** 押す前の下見。**1 件も投入しない。** */
  describe('下見（dryRun）', () => {
    it('1 件も積まず、見込みと飛ばす理由だけ返す', async () => {
      const project = aProject()
      const { shot, take } = adoptedDraft(project)
      const notAdopted = aShot(project.id, { code: 'CUT-01', order: 1000 })
      const f = buildFixture({ project, shots: [shot, notAdopted], takes: [take] })

      const res = await post(f.app, `/projects/${project.id}/shots/bulk/remake-final`, {
        shotIds: [shot.id, notAdopted.id],
        dryRun: true,
      })

      expect(res.status).toBe(200)
      const json = (await res.json()) as { data: RemakeData }
      expect(json.data.dryRun).toBe(true)
      expect(json.data.enqueuedCount).toBe(0)
      expect(json.data.results[0]).toMatchObject({ ok: true, jobIds: [] })
      expect(json.data.results[1]).toMatchObject({ ok: false, reason: NO_SELECTED_TAKE_REASON })
      // **投入していない。** 行もキューも増えない
      expect(f.generationJobs.snapshot()).toEqual([])
      expect(f.queue.enqueued()).toEqual([])
    })

    /**
     * 見込みは**尺に比例**させる（`estimateLatencySec`）。
     * 一律の目安を返すと、短い Shot ばかり選んでも「一晩」と出る。
     */
    it('見込みは Shot ごとに出し、合計はその足し算', async () => {
      const project = aProject()
      const short = adoptedDraft(project)
      const long = (() => {
        const s = aShot(project.id, { code: 'CUT-40', order: 4000, durationSec: 8 })
        const t = aTake(s, 'c'.repeat(64), { modelId: DRAFT.id })
        return { shot: { ...s, selectedTakeId: t.id } as Shot, take: t }
      })()
      const f = buildFixture({
        project,
        shots: [short.shot, long.shot],
        takes: [short.take, long.take],
      })

      const res = await post(f.app, `/projects/${project.id}/shots/bulk/remake-final`, {
        shotIds: [short.shot.id, long.shot.id],
        dryRun: true,
      })

      const json = (await res.json()) as { data: RemakeData }
      const latencyOf = (entry: RemakeData['results'][number] | undefined): number =>
        entry !== undefined && entry.ok ? entry.estimatedLatencySec : 0
      const [shortSec, longSec] = [latencyOf(json.data.results[0]), latencyOf(json.data.results[1])]

      // **尺に比例する。** 一律の目安を返していたら、4 秒と 8 秒が同じ値になって落ちる
      expect(shortSec).toBe(200)
      expect(longSec).toBe(400)
      expect(json.data.estimatedTotalLatencySec).toBe(shortSec + longSec)
    })
  })

  it('無い Project は 404', async () => {
    const project = aProject()
    const { shot, take } = adoptedDraft(project)
    const f = buildFixture({ project, shots: [shot], takes: [take] })

    const res = await post(f.app, `/projects/${aProject().id}/shots/bulk/remake-final`, {
      shotIds: [shot.id],
    })

    expect(res.status).toBe(404)
  })
})
