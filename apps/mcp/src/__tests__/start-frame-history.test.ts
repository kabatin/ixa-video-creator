import { describe, expect, it } from 'vitest'
import { listStartFrameHistoryTool, retryImageTool, useStartFrameTool } from '../tools/start-frames.js'
import { waitTool } from '../tools/wait.js'
import { createFakeApi, depsFor, jsonOf, textOf, ulid } from './fake-api.js'

/** 作った絵のチェック・履歴・選び直し・やり直し（ADR-0055）。 */

const SHOT = ulid('SH1')
const JOB_1 = ulid('JB1')
const JOB_2 = ulid('JB2')
const MEDIA_1 = ulid('MD1')
const MEDIA_2 = ulid('MD2')

const retry = { mark: 'retry', score: 0.2, issues: [{ kind: 'anatomy', message: '指が 6 本' }], note: null }
const pass = { mark: 'pass', score: 0.9, issues: [], note: null }

const historyRow = (jobId: string, mediaAssetId: string | null, patch: Record<string, unknown>) => ({
  jobId,
  status: 'succeeded',
  attempt: 1,
  retryOfJobId: null,
  mediaAssetId,
  applied: false,
  current: false,
  check: null,
  error: null,
  queuedAt: '2026-10-19T00:00:00.000Z',
  ...patch,
})

const history = {
  maxRetries: 2,
  items: [
    historyRow(JOB_2, MEDIA_2, { attempt: 2, retryOfJobId: JOB_1, applied: true, current: true, check: pass, queuedAt: '2026-10-19T00:01:00.000Z' }),
    historyRow(JOB_1, MEDIA_1, { check: retry }),
    historyRow(ulid('JB3'), null, { status: 'failed', error: '作れませんでした' }),
  ],
}

describe('list_start_frame_history', () => {
  it('絵ができたものを古い順に、チェック・使用中・何枚目と返す', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/shots/${SHOT}/start-frame/history`, data: history }])
    const result = jsonOf(await listStartFrameHistoryTool.run({ shotId: SHOT }, depsFor(fake)))
    expect(result).toEqual({
      shotId: SHOT,
      maxAutoRetries: 2,
      frames: [
        { jobId: JOB_1, attempt: 1, mediaAssetId: MEDIA_1, current: false, applied: false, check: retry },
        { jobId: JOB_2, attempt: 2, mediaAssetId: MEDIA_2, current: true, applied: true, check: pass },
      ],
    })
  })
})

describe('use_start_frame', () => {
  it('履歴のジョブの絵を PUT で付ける（取り消せる口）', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/shots/${SHOT}/start-frame/history`, data: history },
      { method: 'PUT', path: `/shots/${SHOT}/start-frame`, data: { mediaAssetId: MEDIA_1 } },
    ])
    const result = jsonOf(await useStartFrameTool.run({ shotId: SHOT, jobId: JOB_1 }, depsFor(fake)))
    expect(fake.callsTo('PUT', `/shots/${SHOT}/start-frame`)[0]?.body).toEqual({ mediaAssetId: MEDIA_1 })
    expect(result).toEqual({ shotId: SHOT, mediaAssetId: MEDIA_1, check: retry })
  })

  it('履歴に無い・絵の無いジョブは理由つきで断る（PUT しない）', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/shots/${SHOT}/start-frame/history`, data: history }])
    const result = await useStartFrameTool.run({ shotId: SHOT, jobId: ulid('JB3') }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/履歴/)
    expect(fake.callsTo('PUT', `/shots/${SHOT}/start-frame`)).toHaveLength(0)
  })
})

describe('retry_image', () => {
  it('やり直しを頼み、新しいジョブを返す', async () => {
    const fake = createFakeApi([{ method: 'POST', path: `/image-jobs/${JOB_1}/retry`, status: 202, data: { jobId: JOB_2 } }])
    expect(jsonOf(await retryImageTool.run({ jobId: JOB_1 }, depsFor(fake)))).toEqual({ retryOf: JOB_1, jobId: JOB_2 })
  })
})

describe('wait {kind:"start_frame"}', () => {
  it('チェック中は待ち、できたら使っている絵のチェックを返す', async () => {
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/shots/${SHOT}/start-frame`,
        sequence: [
          { data: { mediaAssetId: MEDIA_1, job: { id: JOB_1, status: 'checking', error: null, attempt: 1 } } },
          { data: { mediaAssetId: MEDIA_2, job: { id: JOB_2, status: 'succeeded', error: null, attempt: 2 } } },
        ],
      },
      { method: 'GET', path: `/shots/${SHOT}/start-frame/history`, data: history },
    ])
    const result = jsonOf(await waitTool.run({ jobs: [{ kind: 'start_frame', id: SHOT }], maxWaitSec: 30 }, depsFor(fake))) as {
      done: boolean
      results: Record<string, unknown>[]
    }
    expect(fake.callsTo('GET', `/shots/${SHOT}/start-frame`).length).toBeGreaterThan(1)
    expect(result.results).toEqual([{ kind: 'start_frame', id: SHOT, state: 'succeeded', mediaAssetId: MEDIA_2, check: pass, jobId: JOB_2 }])
  })
})
