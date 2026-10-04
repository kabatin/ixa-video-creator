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
import {
  createInMemoryCharacterRepository,
  createInMemoryImageJobRepository,
  createInMemoryShotReferenceRepository,
} from '@ixa/generation/testing'
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
  kind: 'start_frame',
  shotId: shot.id,
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
  const provider = fakeImageProvider(dir, options.outcome)
  const deps = {
    imageJobs: createInMemoryImageJobRepository([job]),
    shots: inMemoryShots([shot]),
    projects: inMemoryProjects([project]),
    characters: createInMemoryCharacterRepository(),
    mediaAssets: inMemoryMediaAssets(),
    shotReferences: createInMemoryShotReferenceRepository(),
    storage: createMemoryStorage(),
    context: options.context ?? contextWithManual(),
    adapters: [{ provider, model: codexCliImageModel }],
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
  return { job, deps, provider }
}

describe('processImageJob', () => {
  /** 使う AI は画面で選び直せる（ADR-0032）。worker は起動時の口ではなく、ジョブに記された口で作る。 */
  it('ジョブに記された口で作る', async () => {
    const { job, deps, provider } = setup()
    const other = { ...fakeImageProvider(dir), id: ProviderId.parse('stub-image') }
    const otherModel = { ...codexCliImageModel, providerId: ProviderId.parse('stub-image'), id: ModelId.parse('stub/gemini-like-image') }

    await processImageJob({ ...deps, adapters: [{ provider: other, model: otherModel }, { provider, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(provider.requests).toHaveLength(1)
    expect(other.requests).toHaveLength(0)
  })

  it('この環境に無い口のジョブは、理由を付けて失敗にする（作り直せない）', async () => {
    const { job, deps } = setup()

    const result = await processImageJob({ ...deps, adapters: [] }, { imageJobId: job.id })

    expect(result).toEqual({ state: 'failed' })
    expect((await deps.imageJobs.findById(job.id))?.error).toMatchObject({ code: 'provider_unavailable', retryable: false })
  })

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
    const { job, deps, provider } = setup()

    await processImageJob(deps, { imageJobId: job.id })

    const request = provider.requests[0]
    expect(request?.prompt).toContain('暗いガレージ')
    expect(request?.prompt).toMatch(/1 フレーム目（動画の開始画像）/)
    expect(request).toMatchObject({ aspectRatio: '16:9', resolution: { width: 1536, height: 1024 }, count: 1 })
  })

  it('参照は手元のファイルへ落として渡し、使った素材を記録する', async () => {
    const referenceId: MediaAssetId = newId(MediaAssetIdSchema)
    const { job, deps, provider } = setup({ context: contextWithManual([{ mediaAssetId: referenceId, role: 'subject' }]) })
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
    const spying = {
      ...provider,
      submit: async (request: Parameters<typeof provider.submit>[0]) => {
        const path = await request.resolveReference(referenceId)
        resolved = path
        expect(await readFile(path)).toEqual(FAKE_PNG)
        return provider.submit(request)
      },
    }

    await processImageJob({ ...deps, adapters: [{ provider: spying, model: codexCliImageModel }] }, { imageJobId: job.id })

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

    expect(ok.provider.released).toEqual(['job-1'])
    expect(failing.provider.released).toEqual(['job-1'])
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
    const { job, deps, provider } = setup()
    const refusing = { ...provider, submit: () => Promise.reject(new Error('モデルでは次の要求を満たせません')) }

    const result = await processImageJob({ ...deps, adapters: [{ provider: refusing, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(result.state).toBe('failed')
    expect((await deps.imageJobs.findById(job.id))?.error?.message).toContain('満たせません')
  })

  it('もう終わったジョブはやり直さない', async () => {
    const { job, deps, provider } = setup()
    await processImageJob(deps, { imageJobId: job.id })

    const again = await processImageJob(deps, { imageJobId: job.id })

    expect(again.state).toBe('skipped')
    expect(provider.requests).toHaveLength(1)
  })
})

/**
 * 止める（制作者 2026-10-04「いま30個ぐらいキューに入ってる画像生成とめたい」「画像生成も停められるようにしよう」）。
 * **止めた絵は最初のフレームを差し替えない。** 止めた後に届いた絵で差し替えると、止めたのに絵が変わる。
 */
describe('processImageJob: 止めたジョブ', () => {
  it('順番待ちの間に止めたジョブは作らない', async () => {
    const { job, deps, provider } = setup()
    await deps.imageJobs.cancelActive({ projectId: project.id })

    const result = await processImageJob(deps, { imageJobId: job.id })

    expect(result).toEqual({ state: 'skipped' })
    expect(provider.requests).toHaveLength(0)
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('cancelled')
  })

  it('作っている途中で止めたら、生成先へ止めてと頼み、最初のフレームは変えない', async () => {
    const { job, deps, provider } = setup({ outcome: 'running' })
    // 生成先が作っている間（見に行ったとき）に止める。
    const poll = provider.poll.bind(provider)
    const stopping = { ...provider, poll: async (handle: Parameters<typeof poll>[0]) => {
      await deps.imageJobs.cancelActive({ projectId: project.id, shotIds: [shot.id] })
      return poll(handle)
    } }

    const result = await processImageJob({ ...deps, adapters: [{ provider: stopping, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(result).toEqual({ state: 'skipped' })
    expect(provider.cancelled).toEqual(['job-1'])
    expect(provider.released).toEqual(['job-1'])
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBeNull()
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('cancelled')
  })

  it('絵が届いた後、差し替える前に止めたら、差し替えない', async () => {
    const { job, deps } = setup()
    const crop = deps.crop
    const result = await processImageJob(
      {
        ...deps,
        crop: async (input: string, output: string) => {
          await deps.imageJobs.cancelActive({ projectId: project.id })
          return crop(input, output)
        },
      },
      { imageJobId: job.id },
    )

    expect(result).toEqual({ state: 'skipped' })
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBeNull()
    expect(deps.mediaAssets.snapshot()).toHaveLength(0)
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('cancelled')
  })
})
