import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  ModelId,
  ProviderId,
  newId,
  type GenerationContextSource,
  type ImageGenerationJob,
  type MediaAssetId,
  type ShotReference,
} from '@ixa/domain'
import { manualStartFrameOf, replaceManualStartFrame } from '@ixa/generation'
import { createInMemoryImageJobRepository, createInMemoryShotReferenceRepository } from '@ixa/generation/testing'
import { codexCliImageModel } from '@ixa/provider-image'
import { createMemoryStorage } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aProject,
  aShot,
  createRecordingEvents,
  createRecordingMediaQueue,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryShots,
  silentLogger,
} from '../../generation/__tests__/doubles.js'
import { processImageJob, type ImageProcessorDeps } from '../processor.js'
import { FAKE_PNG, fakeImageProvider } from './doubles.js'

/**
 * 絵コンテの画像を 1 枚作る（ADR-0029）。成功したら素材として取り込み、Shot の最初のフレームを差し替える。
 * 失敗したら理由を残し、**最初のフレームは変えない**。
 */

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-image-processor-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = aProject()
const shot = aShot(project, { description: '暗いガレージ。作業台にマットブラックのヘルメット' })

const queuedJob = (): ImageGenerationJob => ({
  id: newId(ImageGenerationJobIdSchema),
  projectId: project.id,
  shotId: shot.id,
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
})

const contextWithManual = (references: readonly Pick<ShotReference, 'mediaAssetId' | 'role'>[] = []): GenerationContextSource => ({
  charactersForShot: () => Promise.resolve([]),
  locationsForShot: () => Promise.resolve([]),
  manualReferencesForShot: () =>
    Promise.resolve(
      references.map((reference) => ({
        id: newId(MediaAssetIdSchema) as unknown as ShotReference['id'],
        shotId: shot.id,
        weight: 1,
        order: 0,
        sourceKind: 'manual' as const,
        ...reference,
      })),
    ),
  previousShotLastFrame: () => Promise.resolve(null),
  startFrame: () => Promise.resolve(null),
})

const setup = (options: { outcome?: Parameters<typeof fakeImageProvider>[1]; context?: GenerationContextSource } = {}) => {
  const job = queuedJob()
  const deps = {
    imageJobs: createInMemoryImageJobRepository([job]),
    shots: inMemoryShots([shot]),
    projects: inMemoryProjects([project]),
    mediaAssets: inMemoryMediaAssets(),
    shotReferences: createInMemoryShotReferenceRepository(),
    storage: createMemoryStorage(),
    context: options.context ?? contextWithManual(),
    provider: fakeImageProvider(dir, options.outcome),
    model: codexCliImageModel,
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    workDir: join(dir, 'work'),
    logger: silentLogger,
    pollIntervalMs: 1,
    crop: async (input: string, output: string) => {
      await copyFile(input, output)
      return { width: 1536, height: 864 }
    },
  } satisfies ImageProcessorDeps
  return { job, deps }
}

describe('processImageJob', () => {
  it('作った絵を素材として取り込み、最初のフレームを差し替える', async () => {
    const { job, deps } = setup()

    const result = await processImageJob(deps, { imageJobId: job.id })

    expect(result.state).toBe('succeeded')
    const done = await deps.imageJobs.findById(job.id)
    expect(done?.status).toBe('succeeded')
    const assetId = done?.mediaAssetId ?? null
    expect(assetId).not.toBeNull()
    const asset = deps.mediaAssets.snapshot().find((candidate) => candidate.id === assetId)
    expect(asset).toMatchObject({ kind: 'image', mimeType: 'image/png', origin: { type: 'generated_image', imageJobId: job.id } })
    expect(Buffer.from(await deps.storage.get(asset?.storageKey ?? ''))).toEqual(FAKE_PNG)
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(assetId)
    // サムネイルは既存の media キューが作る。
    expect(deps.mediaQueue.enqueued()).toContain(assetId)
  })

  it('Shot の説明から、比に合わせた形で 1 枚だけ頼む', async () => {
    const { job, deps } = setup()

    await processImageJob(deps, { imageJobId: job.id })

    const request = deps.provider.requests[0]
    expect(request?.prompt).toContain('暗いガレージ')
    expect(request?.prompt).toMatch(/最初の 1 コマ/)
    expect(request).toMatchObject({ aspectRatio: '16:9', resolution: { width: 1536, height: 1024 }, count: 1 })
  })

  it('参照は手元のファイルへ落として渡し、使った素材を記録する', async () => {
    const referenceId: MediaAssetId = newId(MediaAssetIdSchema)
    const { job, deps } = setup({ context: contextWithManual([{ mediaAssetId: referenceId, role: 'subject' }]) })
    await deps.mediaAssets.create({
      id: referenceId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      kind: 'image',
      storageKey: `media/${project.workspaceId}/${referenceId}/original.png`,
      mimeType: 'image/png',
      bytes: FAKE_PNG.byteLength,
      checksumSha256: 'a'.repeat(64),
      origin: { type: 'upload', uploadedBy: 'test' },
    })
    await deps.storage.put(`media/${project.workspaceId}/${referenceId}/original.png`, FAKE_PNG, { contentType: 'image/png' })
    let resolved: string | null = null
    const provider = deps.provider
    const spying = {
      ...provider,
      submit: async (request: Parameters<typeof provider.submit>[0]) => {
        const path = await request.resolveReference(referenceId)
        resolved = path
        expect(await readFile(path)).toEqual(FAKE_PNG)
        return provider.submit(request)
      },
    }

    await processImageJob({ ...deps, provider: spying }, { imageJobId: job.id })

    expect(resolved).not.toMatch(/^https?:/)
    expect((await deps.imageJobs.findById(job.id))?.referenceAssetIds).toEqual([referenceId])
  })

  it('失敗したら理由を残し、最初のフレームは変えない', async () => {
    const { job, deps } = setup({ outcome: { code: 'no_image', message: 'Codex CLI が絵を返しませんでした。' } })
    const previous: MediaAssetId = newId(MediaAssetIdSchema)
    await replaceManualStartFrame(deps.shotReferences, shot.id, previous)

    const result = await processImageJob(deps, { imageJobId: job.id })

    expect(result.state).toBe('failed')
    expect((await deps.imageJobs.findById(job.id))?.error).toMatchObject({ message: 'Codex CLI が絵を返しませんでした。' })
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(previous)
    expect(deps.events.published().at(-1)).toMatchObject({
      type: 'image_job.status',
      status: 'failed',
      error: 'Codex CLI が絵を返しませんでした。',
    })
  })

  /** Provider が手元に置いた出力（Codex の作業ディレクトリ）は、取り込んだら片付けてもらう。 */
  it('取り込んだ後も、失敗した後も、Provider に片付けを頼む', async () => {
    const ok = setup()
    await processImageJob(ok.deps, { imageJobId: ok.job.id })
    const failing = setup({ outcome: { code: 'no_image', message: '絵が無い' } })
    await processImageJob(failing.deps, { imageJobId: failing.job.id })

    expect(ok.deps.provider.released).toEqual(['job-1'])
    expect(failing.deps.provider.released).toEqual(['job-1'])
  })

  it('始まった・終わったを出来事で知らせる', async () => {
    const { job, deps } = setup()

    await processImageJob(deps, { imageJobId: job.id })

    expect(deps.events.published().map((event) => (event.type === 'image_job.status' ? event.status : event.type))).toEqual([
      'running',
      'succeeded',
    ])
  })

  it('頼む前に断られても（大きさ違いなど）、理由を残して終える（投げっぱなしにしない）', async () => {
    const { job, deps } = setup()
    const refusing = { ...deps.provider, submit: () => Promise.reject(new Error('モデルでは次の要求を満たせません')) }

    const result = await processImageJob({ ...deps, provider: refusing }, { imageJobId: job.id })

    expect(result.state).toBe('failed')
    expect((await deps.imageJobs.findById(job.id))?.error?.message).toContain('満たせません')
  })

  it('もう終わったジョブはやり直さない', async () => {
    const { job, deps } = setup()
    await processImageJob(deps, { imageJobId: job.id })

    const again = await processImageJob(deps, { imageJobId: job.id })

    expect(again.state).toBe('skipped')
    expect(deps.provider.requests).toHaveLength(1)
  })
})
