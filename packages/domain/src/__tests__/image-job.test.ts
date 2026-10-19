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
  CharacterId,
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
    kind: 'start_frame',
    shotId: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY'),
    characterId: null,
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

/**
 * キャラクターシート（制作者 2026-10-03「動画生成に役立つ形式のキャラクターシートを 1 枚の画像から作れるといい」）。
 * Codex は 1 度に 1 枚なので、絵コンテの画像と同じジョブ（同じ順番待ち）に種類を足す。
 */
describe('ジョブの種類', () => {
  const characterId = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAZ')

  it('最初のフレームは Shot、キャラクターシートはキャラクターを持つ（もう片方は持たない）', () => {
    expect(imageJobViolation(aJob())).toBeNull()
    expect(imageJobViolation(aJob({ kind: 'character_sheet', shotId: null, characterId }))).toBeNull()

    expect(imageJobViolation(aJob({ shotId: null }))).toMatch(/Shot/)
    expect(imageJobViolation(aJob({ characterId }))).toMatch(/キャラクター/)
    expect(imageJobViolation(aJob({ kind: 'character_sheet', characterId: null, shotId: null }))).toMatch(/キャラクター/)
    expect(imageJobViolation(aJob({ kind: 'character_sheet', characterId }))).toMatch(/Shot/)
  })

  it('出来事はキャラクターシートのジョブも運べる（Shot は無い）', () => {
    const event = ProjectEvent.parse({
      type: 'image_job.status',
      projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      shotId: null,
      characterId,
      jobId,
      status: 'running',
      error: null,
      at: new Date().toISOString(),
    })
    expect(event.type === 'image_job.status' && event.characterId).toBe(characterId)
  })
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

/** 作った絵のチェックとやり直し（ADR-0055）。 */
describe('チェック中・やり直しのつながり', () => {
  it('チェック中は絵を持つ（見ている最中の絵）。絵が無ければ破れ', () => {
    expect(imageJobViolation(aJob({ status: 'checking', mediaAssetId: assetId }))).toBeNull()
    expect(imageJobViolation(aJob({ status: 'checking' }))).toMatch(/チェック/)
  })

  it('チェック中に止めた行は絵を持ったまま残る（止める前に絵があったかどうかは問わない）', () => {
    expect(imageJobViolation(aJob({ status: 'cancelled', mediaAssetId: assetId }))).toBeNull()
    expect(imageJobViolation(aJob({ status: 'cancelled' }))).toBeNull()
    expect(imageJobViolation(aJob({ status: 'queued', mediaAssetId: assetId }))).not.toBeNull()
  })

  it('前からある行は 1 枚目で、つながりも当てた記録も無い', () => {
    const job = aJob()
    expect(job.attempt).toBe(1)
    expect(job.retryOfJobId).toBeNull()
    expect(job.appliedAt).toBeNull()
  })

  it('試しの番号は 1 以上の整数', () => {
    expect(ImageGenerationJob.safeParse({ ...aJob(), attempt: 0 }).success).toBe(false)
    expect(ImageGenerationJob.safeParse({ ...aJob(), attempt: 1.5 }).success).toBe(false)
  })

  it('やり直しは前のジョブを指し、2 枚目以降。1 枚目なのに前がある・やり直しなのに前が無い、は破れ', () => {
    const previous = ImageGenerationJobId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0')
    expect(imageJobViolation(aJob({ attempt: 2, retryOfJobId: previous }))).toBeNull()
    expect(imageJobViolation(aJob({ attempt: 2 }))).toMatch(/前/)
    expect(imageJobViolation(aJob({ attempt: 1, retryOfJobId: previous }))).toMatch(/前/)
  })

  it('当てたのは絵が仕上がったジョブだけ', () => {
    expect(imageJobViolation(aJob({ status: 'succeeded', mediaAssetId: assetId, appliedAt: new Date() }))).toBeNull()
    expect(imageJobViolation(aJob({ appliedAt: new Date() }))).toMatch(/当て/)
  })
})
