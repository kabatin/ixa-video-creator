import { ReviewRunId, TakeId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHOT_ID, TAKE_ID, takeJson } from '@/__tests__/fixtures'
import { createRequester } from '@/lib/requester'
import { createReviewApi, HumanDecision, VerdictBody } from '@/lib/review-api'

const BASE_URL = 'http://127.0.0.1:3001'

const REVIEW_RUN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FE0'
const REVIEW_RUN_ID_OLD = '01ARZ3NDEKTSV4RRFFQ69G5FE1'
const REVIEW_FINDING_ID = '01ARZ3NDEKTSV4RRFFQ69G5FE2'

const takeId = TakeId.parse(TAKE_ID)
const reviewRunId = ReviewRunId.parse(REVIEW_RUN_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const runJson = {
  id: REVIEW_RUN_ID,
  takeId: TAKE_ID,
  reviewers: ['technical', 'identity'],
  status: 'done',
  verdict: 'warn',
  costUsd: 0.012,
  createdAt: '2026-09-16T02:00:00.000Z',
}

const olderRunJson = {
  ...runJson,
  id: REVIEW_RUN_ID_OLD,
  verdict: 'fail',
  createdAt: '2026-09-16T01:00:00.000Z',
}

const findingJson = {
  id: REVIEW_FINDING_ID,
  reviewRunId: REVIEW_RUN_ID,
  reviewer: 'identity',
  severity: 'warn',
  score: 0.72,
  message: '主人公の顔が参照と一致しません',
  evidence: { frameSec: 2.5, bbox: [0.1, 0.2, 0.3, 0.4], comparedAssetId: null },
  suggestedPromptDelta: 'keep the same face as the reference',
}

const fetchMock = vi.fn<typeof fetch>()

const api = () => createReviewApi(createRequester(BASE_URL))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('レビューの起動', () => {
  it('本文なしで POST し、受け付けられたことだけを返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { takeId: TAKE_ID, queued: true } }, 202),
    )

    const accepted = await api().requestReview(takeId)

    expect(accepted.queued).toBe(true)
    expect(accepted.takeId).toBe(TAKE_ID)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/takes/${TAKE_ID}/review`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toBeUndefined()
  })

  it('失敗は握り潰さず投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))

    await expect(api().requestReview(takeId)).rejects.toThrow()
  })
})

describe('レビュー実行の一覧', () => {
  it('takeId で引き、createdAt を Date にする', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [runJson, olderRunJson],
        meta: { total: 2 },
      }),
    )

    const runs = await api().listReviewRuns(takeId)

    expect(runs).toHaveLength(2)
    expect(runs[0]?.createdAt).toBeInstanceOf(Date)
    expect(runs[0]?.createdAt.toISOString()).toBe('2026-09-16T02:00:00.000Z')
    expect(runs[0]?.verdict).toBe('warn')

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/takes/${TAKE_ID}/reviews`)
  })

  it('1 度も実行していなければ空配列', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], meta: { total: 0 } }))

    await expect(api().listReviewRuns(takeId)).resolves.toEqual([])
  })
})

describe('レビュー実行の詳細', () => {
  it('run と findings を 1 往復で受け取る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { run: runJson, findings: [findingJson] } }),
    )

    const detail = await api().getReviewRun(reviewRunId)

    expect(detail.run.id).toBe(REVIEW_RUN_ID)
    expect(detail.findings).toHaveLength(1)
    expect(detail.findings[0]?.evidence?.frameSec).toBe(2.5)
    expect(detail.findings[0]?.suggestedPromptDelta).toBe('keep the same face as the reference')

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/review-runs/${REVIEW_RUN_ID}`)
  })

  it('証拠のない指摘（evidence: null）も受け取れる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          run: runJson,
          findings: [{ ...findingJson, evidence: null, score: null, suggestedPromptDelta: null }],
        },
      }),
    )

    const detail = await api().getReviewRun(reviewRunId)

    expect(detail.findings[0]?.evidence).toBeNull()
    expect(detail.findings[0]?.score).toBeNull()
  })

  it('未知の severity は検証で弾く（画面に出す前に落とす）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { run: runJson, findings: [{ ...findingJson, severity: 'critical' }] },
      }),
    )

    await expect(api().getReviewRun(reviewRunId)).rejects.toThrow()
  })
})

describe('人間の判断', () => {
  it('承認を送り、更新後の Take を返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...takeJson, humanVerdict: 'approved' } }),
    )

    const take = await api().setTakeVerdict(takeId, 'approved')

    expect(take.humanVerdict).toBe('approved')
    expect(take.shotId).toBe(SHOT_ID)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/takes/${TAKE_ID}/verdict`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toEqual({ verdict: 'approved' })
  })

  it('却下も同じ経路で送る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...takeJson, humanVerdict: 'rejected' } }),
    )

    await api().setTakeVerdict(takeId, 'rejected')

    expect(requestBodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({ verdict: 'rejected' })
  })

  it('unreviewed は人間が下せる判断ではないので送れない', () => {
    expect(HumanDecision.safeParse('unreviewed').success).toBe(false)
    expect(VerdictBody.safeParse({ verdict: 'unreviewed' }).success).toBe(false)
    expect(VerdictBody.safeParse({ verdict: 'approved' }).success).toBe(true)
  })

  it('保存の失敗は握り潰さず投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: '権限がありません' }, 403))

    await expect(api().setTakeVerdict(takeId, 'approved')).rejects.toThrow()
  })
})
