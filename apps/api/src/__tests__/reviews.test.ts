import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ReviewRunId as ReviewRunIdSchema,
  TakeId as TakeIdSchema,
  newId,
  type CreateReviewFindingInput,
  type ReviewRun,
  type Shot,
  type Take,
  type TakeId,
} from '@ixa/domain'
import { aShot, aTake } from '@ixa/generation/testing'
import { createInMemoryTakeRepository, type InMemoryTakeRepository } from '@ixa/generation/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  reviewRoutes,
  type ReviewQueue,
  type ReviewRoutesDeps,
} from '../routes/reviews.js'
import { aProject } from './fixtures.js'
import {
  createInMemoryReviewRepository,
  REVIEW_RUN_CREATED_AT,
  type InMemoryReviewRepository,
} from './in-memory-review-repository.js'

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type RunBody = {
  id: string
  takeId: string
  reviewers: string[]
  status: string
  verdict: string | null
  costUsd: number
  createdAt: string
}
type FindingBody = { id: string; reviewer: string; severity: string; message: string }
type DetailBody = { run: RunBody; findings: FindingBody[] }
type TakeBody = { id: string; reviewStatus: string; humanVerdict: string }

const project = aProject()

/** 投入された TakeId を記録するだけのキュー。Redis には接続しない。 */
const createRecordingQueue = (): ReviewQueue & { enqueued: () => readonly TakeId[] } => {
  const enqueued: TakeId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (takeId) => {
      enqueued.push(takeId)
      return Promise.resolve()
    },
  }
}

const aFinding = (
  overrides: Partial<CreateReviewFindingInput> = {},
): CreateReviewFindingInput => ({
  reviewer: 'technical',
  severity: 'fail',
  score: null,
  message: '尺が指示より 0.4 秒短い',
  evidence: null,
  suggestedPromptDelta: null,
  ...overrides,
})

let shot: Shot
let take: Take
let takes: InMemoryTakeRepository
let reviews: InMemoryReviewRepository
let queue: ReturnType<typeof createRecordingQueue>
let app: OpenAPIHono

const buildApp = (deps: ReviewRoutesDeps) => {
  const built = new OpenAPIHono({ defaultHook: validationHook })
  built.route('/', reviewRoutes(deps))
  registerErrorHandlers(built, createLogger('silent'))
  return built
}

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

/** 完了済みの ReviewRun を 1 件積む。指摘は呼び出し側が渡す。 */
const seedRun = async (
  targetId: TakeId,
  overrides: Partial<Omit<ReviewRun, 'id' | 'createdAt'>> = {},
  findings: readonly CreateReviewFindingInput[] = [],
): Promise<ReviewRun> => {
  const run = await reviews.createRun({
    takeId: targetId,
    reviewers: ['technical', 'music'],
    status: 'done',
    verdict: 'pass',
    costUsd: 0,
    ...overrides,
  })
  await reviews.addFindings(run.id, findings)
  return run
}

beforeEach(() => {
  shot = aShot(project.id)
  take = aTake(shot, 'a'.repeat(64))
  takes = createInMemoryTakeRepository([take])
  reviews = createInMemoryReviewRepository()
  queue = createRecordingQueue()
  app = buildApp({ takes, reviews, queue })
})

describe('レビューの起動', () => {
  it('202 を返してキューへ積む（結果は待たない）', async () => {
    const res = await send('POST', `/takes/${take.id}/review`)

    expect(res.status).toBe(202)
    const body = await json<SuccessBody<{ takeId: string; queued: boolean }>>(res)
    expect(body.data).toEqual({ takeId: take.id, queued: true })
    expect(queue.enqueued()).toEqual([take.id])
  })

  it('ReviewRun は API では作らない（実際に走ったレビュアは worker しか知らない）', async () => {
    await send('POST', `/takes/${take.id}/review`)
    expect(reviews.snapshotRuns()).toHaveLength(0)
  })

  it('レビュー済みでも積み直せる（冪等判定は worker が持つ）', async () => {
    await seedRun(take.id, { verdict: 'fail' })

    expect((await send('POST', `/takes/${take.id}/review`)).status).toBe(202)
    expect(queue.enqueued()).toEqual([take.id])
  })

  it('存在しない Take は 404 で、キューに積まない', async () => {
    const res = await send('POST', `/takes/${newId(TakeIdSchema)}/review`)

    expect(res.status).toBe(404)
    expect(queue.enqueued()).toHaveLength(0)
  })
})

describe('レビュー履歴の取得', () => {
  it('新しい順に返す（直近の判定が先頭）', async () => {
    const first = await seedRun(take.id, { verdict: 'fail' })
    const second = await seedRun(take.id, { verdict: 'pass' })

    const res = await send('GET', `/takes/${take.id}/reviews`)

    expect(res.status).toBe(200)
    const body = await json<ListBody<RunBody>>(res)
    expect(body.data.map((run) => run.id)).toEqual([second.id, first.id])
    expect(body.meta.total).toBe(2)
  })

  it('他の Take の実行は混ざらない', async () => {
    const other = await takes.create({ ...take, id: newId(TakeIdSchema) })
    await seedRun(other.id)
    await seedRun(take.id)

    const body = await json<ListBody<RunBody>>(await send('GET', `/takes/${take.id}/reviews`))
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.takeId).toBe(take.id)
  })

  it('未レビューの Take は空の一覧を返す（404 にしない）', async () => {
    const res = await send('GET', `/takes/${take.id}/reviews`)

    expect(res.status).toBe(200)
    expect((await json<ListBody<RunBody>>(res)).data).toEqual([])
  })

  it('日時は ISO8601 文字列で返す', async () => {
    await seedRun(take.id)
    const body = await json<ListBody<RunBody>>(await send('GET', `/takes/${take.id}/reviews`))
    expect(body.data[0]?.createdAt).toBe(REVIEW_RUN_CREATED_AT.toISOString())
  })

  it('実行中の判定は verdict が null のまま返る', async () => {
    await seedRun(take.id, { status: 'running', verdict: null })

    const body = await json<ListBody<RunBody>>(await send('GET', `/takes/${take.id}/reviews`))
    expect(body.data[0]?.status).toBe('running')
    expect(body.data[0]?.verdict).toBeNull()
  })

  it('存在しない Take は 404', async () => {
    expect((await send('GET', `/takes/${newId(TakeIdSchema)}/reviews`)).status).toBe(404)
  })
})

describe('1 回分の実行の取得', () => {
  it('実行と、その指摘を一緒に返す', async () => {
    const run = await seedRun(take.id, { verdict: 'fail' }, [
      aFinding(),
      aFinding({ reviewer: 'music', severity: 'warn', message: 'Shot 境界がビートから 80ms ずれている' }),
    ])

    const res = await send('GET', `/review-runs/${run.id}`)

    expect(res.status).toBe(200)
    const body = await json<SuccessBody<DetailBody>>(res)
    expect(body.data.run.id).toBe(run.id)
    expect(body.data.run.verdict).toBe('fail')
    expect(body.data.findings.map((f) => f.reviewer)).toEqual(['technical', 'music'])
  })

  it('指摘が 0 件でも 200（「指摘なし」は正常な結果）', async () => {
    const run = await seedRun(take.id)

    const res = await send('GET', `/review-runs/${run.id}`)
    expect(res.status).toBe(200)
    expect((await json<SuccessBody<DetailBody>>(res)).data.findings).toEqual([])
  })

  it('他の実行の指摘は混ざらない', async () => {
    const target = await seedRun(take.id, {}, [aFinding({ message: 'これだけが返る' })])
    await seedRun(take.id, {}, [aFinding({ message: '別の実行の指摘' })])

    const body = await json<SuccessBody<DetailBody>>(await send('GET', `/review-runs/${target.id}`))
    expect(body.data.findings.map((f) => f.message)).toEqual(['これだけが返る'])
  })

  it('存在しない実行は 404', async () => {
    expect((await send('GET', `/review-runs/${newId(ReviewRunIdSchema)}`)).status).toBe(404)
  })
})

describe('人間の最終判断', () => {
  it('approved を記録して更新後の Take を返す', async () => {
    const res = await send('POST', `/takes/${take.id}/verdict`, { verdict: 'approved' })

    expect(res.status).toBe(200)
    const body = await json<SuccessBody<TakeBody>>(res)
    expect(body.data.humanVerdict).toBe('approved')
    expect(takes.snapshot()[0]?.humanVerdict).toBe('approved')
  })

  it('rejected も記録できる', async () => {
    const res = await send('POST', `/takes/${take.id}/verdict`, { verdict: 'rejected' })
    expect((await json<SuccessBody<TakeBody>>(res)).data.humanVerdict).toBe('rejected')
  })

  it('reviewStatus は書き換えない（「fail だったが人間が通した」を残す）', async () => {
    takes = createInMemoryTakeRepository([{ ...take, reviewStatus: 'failed' }])
    app = buildApp({ takes, reviews, queue })

    const res = await send('POST', `/takes/${take.id}/verdict`, { verdict: 'approved' })

    const body = await json<SuccessBody<TakeBody>>(res)
    expect(body.data.reviewStatus).toBe('failed')
    expect(body.data.humanVerdict).toBe('approved')
  })

  it('Take の他の列は動かない（追記のみ・ADR-0003）', async () => {
    await send('POST', `/takes/${take.id}/verdict`, { verdict: 'approved' })

    const stored = takes.snapshot()[0]
    expect(stored).toEqual({ ...take, humanVerdict: 'approved' })
  })

  it('知らない verdict は 422 で弾き、記録しない', async () => {
    const res = await send('POST', `/takes/${take.id}/verdict`, { verdict: 'maybe' })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.verdict).toBeDefined()
    expect(takes.snapshot()[0]?.humanVerdict).toBe('unreviewed')
  })

  it('unreviewed へは戻せない（判断の取り消しは記録に残らない）', async () => {
    const res = await send('POST', `/takes/${take.id}/verdict`, { verdict: 'unreviewed' })
    expect(res.status).toBe(422)
  })

  it('verdict が無い本文は 422', async () => {
    expect((await send('POST', `/takes/${take.id}/verdict`, {})).status).toBe(422)
  })

  it('存在しない Take は 404', async () => {
    const res = await send('POST', `/takes/${newId(TakeIdSchema)}/verdict`, { verdict: 'approved' })
    expect(res.status).toBe(404)
  })
})
