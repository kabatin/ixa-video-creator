import { describe, expect, it } from 'vitest'
import {
  ImageGenerationJob,
  ImageGenerationJobId,
  imageJobViolation,
  MediaAssetId,
  MediaOrigin,
  ModelId,
  ProjectEvent,
  ProjectId,
  ProviderId,
  SHOT_LIST_EVENT_TYPES,
  ShotId,
} from '../index.js'

/**
 * 絵コンテの画像を作るジョブ（ADR-0029）。**追記のみ**（作り直しても前の絵と記録は残る）。
 */

const jobId = ImageGenerationJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')
const assetId = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW')

const aJob = (patch: Partial<ImageGenerationJob> = {}): ImageGenerationJob =>
  ImageGenerationJob.parse({
    id: jobId,
    projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAX'),
    shotId: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY'),
    status: 'queued',
    providerId: ProviderId.parse('codex-cli'),
    modelId: ModelId.parse('codex-cli/image-gen'),
    referenceAssetIds: [],
    mediaAssetId: null,
    error: null,
    providerRecord: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...patch,
  })

describe('ImageGenerationJob', () => {
  it('待っているジョブを読める', () => {
    expect(aJob().status).toBe('queued')
  })

  it('成功・失敗と、できた絵・理由の有無が食い違わない', () => {
    expect(imageJobViolation(aJob())).toBeNull()
    expect(imageJobViolation(aJob({ status: 'succeeded', mediaAssetId: assetId }))).toBeNull()
    expect(
      imageJobViolation(aJob({ status: 'failed', error: { code: 'no_image', message: '絵が無い', retryable: true } })),
    ).toBeNull()
  })

  it('成功なのに絵が無い・失敗なのに理由が無い・途中なのに絵がある、は破れ', () => {
    expect(imageJobViolation(aJob({ status: 'succeeded' }))).not.toBeNull()
    expect(imageJobViolation(aJob({ status: 'failed' }))).not.toBeNull()
    expect(imageJobViolation(aJob({ status: 'running', mediaAssetId: assetId }))).not.toBeNull()
  })
})

describe('絵の出どころ', () => {
  /** 今の `generated` は Take 必須。絵コンテの画像は Take ではないので、別の出どころにする。 */
  it('絵コンテの画像ジョブから作った絵を表せる', () => {
    expect(MediaOrigin.parse({ type: 'generated_image', imageJobId: jobId })).toEqual({
      type: 'generated_image',
      imageJobId: jobId,
    })
  })
})

describe('出来事 image_job.status', () => {
  it('Shot・ジョブ・状態・理由を運ぶ', () => {
    const event = ProjectEvent.parse({
      type: 'image_job.status',
      projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      at: '2026-09-28T12:00:00.000Z',
      shotId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
      jobId,
      status: 'failed',
      error: 'Codex CLI が絵を返しませんでした。',
    })
    expect(event.type).toBe('image_job.status')
  })

  it('Shot の一覧が描き直しに使う', () => {
    expect(SHOT_LIST_EVENT_TYPES).toContain('image_job.status')
  })
})
