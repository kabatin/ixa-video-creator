import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { imageCheckRowToDomain, type ImageCheckRow } from '../repositories/image-check-repository.js'
import { imageJobRowToDomain, type ImageJobRow } from '../repositories/image-job-repository.js'
import { imageChecks, imageGenerationJobs } from '../schema/image-job.js'

/**
 * 作った絵のチェックとやり直しのつながり（ADR-0055）。実 DB には接続しない。
 */

const checkRow = (patch: Partial<ImageCheckRow> = {}): ImageCheckRow => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
  imageJobId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  outcome: 'checked',
  verdict: 'retry',
  score: 0.3,
  issues: [{ kind: 'anatomy', message: '指が 6 本' }],
  promptDelta: 'five fingers',
  note: null,
  costUsd: 0.02,
  createdAt: new Date('2026-10-19T00:00:00Z'),
  ...patch,
})

const jobRow = (patch: Partial<ImageJobRow> = {}): ImageJobRow => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  kind: 'start_frame',
  shotId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  characterId: null,
  status: 'checking',
  instruction: null,
  providerId: 'klein',
  modelId: 'klein/flux-2-klein',
  referenceAssetIds: [],
  mediaAssetId: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
  error: null,
  providerRecord: {},
  retryOfJobId: null,
  attempt: 1,
  appliedAt: null,
  queuedAt: new Date('2026-10-19T00:00:00Z'),
  startedAt: null,
  finishedAt: null,
  ...patch,
})

describe('image_checks', () => {
  it('見た行・飛ばした行を domain の型にする', () => {
    expect(imageCheckRowToDomain(checkRow())).toMatchObject({ verdict: 'retry', score: 0.3 })
    expect(
      imageCheckRowToDomain(checkRow({ outcome: 'skipped', verdict: null, score: null, issues: [], note: '使える AI が無い' })),
    ).toMatchObject({ outcome: 'skipped' })
  })

  it('飛ばしたのに判定がある・範囲を外れた点の行は止める', () => {
    expect(() => imageCheckRowToDomain(checkRow({ outcome: 'skipped', note: 'x' }))).toThrow(/判定/)
    expect(() => imageCheckRowToDomain(checkRow({ score: 1.2 }))).toThrow()
  })

  it('ジョブに 1 行（同じジョブを二重に見て払わない）', () => {
    const unique = getTableConfig(imageChecks).indexes.find((index) => index.config.name === 'image_checks_image_job_id_idx')
    expect(unique?.config.unique).toBe(true)
  })
})

describe('image_generation_jobs のつながり', () => {
  it('チェック中の行は絵を持つ', () => {
    expect(imageJobRowToDomain(jobRow()).status).toBe('checking')
    expect(() => imageJobRowToDomain(jobRow({ mediaAssetId: null }))).toThrow(/チェック中/)
  })

  it('やり直しの行は前のジョブと番号を持つ。食い違えば止める', () => {
    expect(imageJobRowToDomain(jobRow({ attempt: 2, retryOfJobId: '01ARZ3NDEKTSV4RRFFQ69G5FA0' })).attempt).toBe(2)
    expect(() => imageJobRowToDomain(jobRow({ attempt: 2 }))).toThrow(/前/)
  })

  it('列の名前', () => {
    const columns = getTableConfig(imageGenerationJobs).columns.map((column) => column.name)
    expect(columns).toEqual(expect.arrayContaining(['retry_of_job_id', 'attempt', 'applied_at']))
  })
})

describe('retryImageJobInput', () => {
  it('同じ種類・持ち主・AI で、前のジョブを指して番号を 1 つ進める', async () => {
    const { retryImageJobInput } = await import('../repositories/image-job-repository.js')
    const job = imageJobRowToDomain(jobRow({ status: 'succeeded', attempt: 2, retryOfJobId: '01ARZ3NDEKTSV4RRFFQ69G5FA0' }))
    expect(retryImageJobInput(job)).toMatchObject({
      kind: 'start_frame',
      shotId: job.shotId,
      providerId: job.providerId,
      modelId: job.modelId,
      retryOf: { jobId: job.id, attempt: 3 },
    })
    const sheet = imageJobRowToDomain(
      jobRow({ kind: 'character_sheet', shotId: null, characterId: '01ARZ3NDEKTSV4RRFFQ69G5FA9', referenceAssetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FA8'] }),
    )
    expect(retryImageJobInput(sheet)).toMatchObject({ kind: 'character_sheet', referenceAssetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FA8'] })
  })
})

/** レビューの指摘（2026-10-19）。一意と消し方は実際の DB でも確かめる（*.integration.test.ts）。 */
describe('やり直しのつながりの一意と消し方', () => {
  it('1 つのジョブのやり直しは 1 行だけ（null は数えない部分インデックス）', () => {
    const index = getTableConfig(imageGenerationJobs).indexes.find(
      (candidate) => candidate.config.name === 'image_generation_jobs_retry_of_job_id_uidx',
    )
    expect(index?.config.unique).toBe(true)
    expect(index?.config.where).toBeDefined()
  })
})
