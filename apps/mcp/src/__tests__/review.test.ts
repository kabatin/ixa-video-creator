import { describe, expect, it } from 'vitest'
import { reviewTakeTool } from '../tools/review.js'
import { waitTool } from '../tools/wait.js'
import { createFakeApi, depsFor, jsonOf, ulid } from './fake-api.js'

/**
 * Take のレビューを頼む（ADR-0057）。自動の作り直しを選んでいない Take は、エージェントが自分で確かめる口が要る。
 * 結果は wait {kind:"review", id: takeId} で、判定・費用・指摘（直し方つき）を受け取る。
 */

const TAKE = ulid('TK1')
const RUN = ulid('RR1')

const run = (status: string, verdict: string | null) => ({
  id: RUN,
  takeId: TAKE,
  reviewers: ['technical'],
  status,
  verdict,
  costUsd: 0.03,
  createdAt: '2026-10-23T00:00:00.000Z',
})

describe('review_take', () => {
  it('レビューを頼み、wait の手がかりを返す', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/takes/${TAKE}/review`, status: 202, data: { takeId: TAKE, queued: true } }])
    expect(jsonOf(await reviewTakeTool.run({ takeId: TAKE }, depsFor(fake)))).toEqual({
      takeId: TAKE,
      queued: true,
      next: { tool: 'wait', jobs: [{ kind: 'review', id: TAKE }] },
    })
  })
})

describe('wait {kind:"review"}', () => {
  it('走っている間は待ち、終わったら判定・費用・指摘を返す', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/takes/${TAKE}/reviews`, sequence: [{ data: [run('running', null)] }, { data: [run('done', 'fail')] }] },
      {
        method: 'GET',
        path: `/review-runs/${RUN}`,
        data: {
          run: run('done', 'fail'),
          findings: [
            {
              id: ulid('RF1'),
              reviewRunId: RUN,
              reviewer: 'identity',
              severity: 'fail',
              score: 0.2,
              message: '顔が参照と違う',
              evidence: null,
              suggestedPromptDelta: 'keep the face of the reference',
            },
          ],
        },
      },
    ])
    const result = jsonOf(await waitTool.run({ jobs: [{ kind: 'review', id: TAKE }], maxWaitSec: 30 }, depsFor(fake))) as {
      results: Record<string, unknown>[]
    }
    expect(result.results).toEqual([
      {
        kind: 'review',
        id: TAKE,
        state: 'succeeded',
        verdict: 'fail',
        costUsd: 0.03,
        findings: [{ reviewer: 'identity', severity: 'fail', message: '顔が参照と違う', fix: 'keep the face of the reference' }],
      },
    ])
  })

  it('まだ頼んでいなければ、頼んでいないと返す（待たない）', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/takes/${TAKE}/reviews`, data: [] }])
    const result = jsonOf(await waitTool.run({ jobs: [{ kind: 'review', id: TAKE }], maxWaitSec: 30 }, depsFor(fake))) as {
      results: Record<string, unknown>[]
    }
    expect(result.results[0]).toMatchObject({ kind: 'review', id: TAKE, state: 'failed' })
  })
})
