import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ModelId,
  ProviderId,
  newId,
  type ImageGenerationJob,
} from '@ixa/domain'
import { createInMemoryImageJobRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { aProject, aShot, createRecordingEvents, silentLogger } from '../../generation/__tests__/doubles.js'
import { failInterruptedImageJob, INTERRUPTED_IMAGE_JOB_CODE } from '../interrupted.js'

/**
 * キューが処理の外でジョブを打ち切ったとき（制作者 2026-10-02「再度生成しようと思ったら生成中だからできないって言われた」）。
 * 作っている最中に worker が 2 回落ち、BullMQ が「止まりすぎ」で打ち切った。処理は走らず、行は「作っている」のまま残り、
 * 作り直しが「作っている」で断られ続けた。打ち切られたら行を失敗にして画面へ知らせる。
 */

const project = aProject()
const shot = aShot(project)

const jobIn = (status: ImageGenerationJob['status']): ImageGenerationJob => ({
  id: newId(ImageGenerationJobIdSchema),
  projectId: project.id,
  kind: 'start_frame',
  shotId: shot.id,
  characterId: null,
  status,
  providerId: ProviderId.parse('codex-cli'),
  modelId: ModelId.parse('codex-cli/image-gen'),
  referenceAssetIds: [],
  mediaAssetId: null,
  error: null,
  providerRecord: null,
  queuedAt: new Date(),
  startedAt: status === 'queued' ? null : new Date(),
  finishedAt: null,
})

const setup = (job: ImageGenerationJob) => ({
  imageJobs: createInMemoryImageJobRepository([job]),
  events: createRecordingEvents(),
  logger: silentLogger,
})

describe('failInterruptedImageJob', () => {
  it.each(['running', 'queued'] as const)('%s のまま打ち切られた行を失敗にし、画面へ知らせる', async (status) => {
    const job = jobIn(status)
    const deps = setup(job)

    await failInterruptedImageJob(deps, { imageJobId: job.id }, 'job stalled more than allowable limit')

    const saved = await deps.imageJobs.findById(job.id)
    expect(saved?.status).toBe('failed')
    expect(saved?.error).toMatchObject({ code: INTERRUPTED_IMAGE_JOB_CODE, retryable: true })
    // 見る人に向けた文。キューの英語の理由は出さない（記録にだけ残す）。
    expect(saved?.error?.message).toMatch(/作り直してください/)
    expect(saved?.error?.message).not.toMatch(/stalled/)
    expect(saved?.providerRecord).toEqual({ queueFailure: 'job stalled more than allowable limit' })
    expect(deps.events.published().at(-1)).toMatchObject({
      type: 'image_job.status',
      jobId: job.id,
      status: 'failed',
    })
  })

  it.each(['succeeded', 'failed'] as const)('終わった行（%s）は変えない', async (status) => {
    const job: ImageGenerationJob = {
      ...jobIn('running'),
      status,
      finishedAt: new Date(),
      error: status === 'failed' ? { code: 'x', message: '前の理由', retryable: true } : null,
    }
    const deps = setup(job)
    const before = await deps.imageJobs.findById(job.id)

    await failInterruptedImageJob(deps, { imageJobId: job.id }, 'job stalled more than allowable limit')

    expect(await deps.imageJobs.findById(job.id)).toEqual(before)
    expect(deps.events.published()).toEqual([])
  })

  it('行が無い・データが読めないときは投げない（記録だけ）', async () => {
    const deps = setup(jobIn('running'))

    await expect(
      failInterruptedImageJob(deps, { imageJobId: newId(ImageGenerationJobIdSchema) }, 'x'),
    ).resolves.toBeUndefined()
    await expect(failInterruptedImageJob(deps, { other: 1 }, 'x')).resolves.toBeUndefined()
    expect(deps.events.published()).toEqual([])
  })
})
