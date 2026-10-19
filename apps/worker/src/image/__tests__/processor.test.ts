import { createInMemoryLocalGpuLease } from '../../generation/local-gpu-lease.js'
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
import { ProviderError } from '@ixa/provider-core'
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
import type { ImageProcessorDeps } from '../processor.js'
import { checkDeps, runImageJob } from './queue-doubles.js'
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
  retryOfJobId: null,
  attempt: 1,
  appliedAt: null,
  instruction: null,
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
    ...checkDeps(),
    imageJobs: createInMemoryImageJobRepository([job]),
    shots: inMemoryShots([shot]),
    projects: inMemoryProjects([project]),
    characters: createInMemoryCharacterRepository(),
    concept: () => Promise.resolve(''),
    mediaAssets: inMemoryMediaAssets(),
    shotReferences: createInMemoryShotReferenceRepository(),
    storage: createMemoryStorage(),
    context: options.context ?? contextWithManual(),
    adapters: [{ provider, model: codexCliImageModel }],
    localGpuLease: createInMemoryLocalGpuLease(),
    scheduler: { reschedule: () => Promise.resolve() },
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
  /** ADR-0047。手元の GPU を使う口（klein）は、作っている間だけ動画と同じ順番を借りる。 */
  it('手元の GPU を名乗る口は、作っている間だけ順番を借りて、終わったら返す', async () => {
    const { job, deps, provider } = setup()
    const lease = createInMemoryLocalGpuLease()
    const seenBySubmit: string[] = []
    const local = {
      ...provider,
      exclusiveResource: 'local-gpu' as const,
      submit: async (request: Parameters<typeof provider.submit>[0]) => {
        seenBySubmit.push((await lease.acquire('video-job', Date.now())).state)
        return provider.submit(request)
      },
    }
    const result = await runImageJob({ ...deps, localGpuLease: lease, adapters: [{ provider: local, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(result).toEqual({ state: 'succeeded' })
    expect(seenBySubmit).toEqual(['held'])
    expect((await lease.acquire('video-job', Date.now())).state).toBe('acquired')
  })

  /** 待つ間 worker の処理枠を握ると、GPU を使わない Codex の絵まで止まる。積み直して手を離す。 */
  it('手元の GPU の順番が来ていなければ、作らずに積み直す（ジョブは queued のまま）', async () => {
    const { job, deps, provider } = setup()
    const lease = createInMemoryLocalGpuLease()
    await lease.acquire('video-job', job.queuedAt.getTime() - 1000)
    const rescheduled: { data: unknown; delayMs: number }[] = []
    const result = await runImageJob(
      {
        ...deps,
        localGpuLease: lease,
        scheduler: { reschedule: (data, delayMs) => { rescheduled.push({ data, delayMs }); return Promise.resolve() } },
        adapters: [{ provider: { ...provider, exclusiveResource: 'local-gpu' as const }, model: codexCliImageModel }],
      },
      { imageJobId: job.id },
    )
    expect(result).toEqual({ state: 'waiting' })
    expect(rescheduled).toEqual([{ data: { imageJobId: job.id }, delayMs: expect.any(Number) as unknown }])
    expect(provider.requests).toHaveLength(0)
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('queued')
  })

  it('問い合わせが 1 回だけ通信で失敗しても、絵を捨てない', async () => {
    const { job, deps, provider } = setup()
    let calls = 0
    const flaky = {
      ...provider,
      poll: (handle: Parameters<typeof provider.poll>[0]) => {
        calls += 1
        return calls === 1
          ? Promise.reject(new ProviderError('つながりません', ProviderId.parse('klein'), true))
          : provider.poll(handle)
      },
    }
    const result = await runImageJob({ ...deps, adapters: [{ provider: flaky, model: codexCliImageModel }] }, { imageJobId: job.id })
    expect(result).toEqual({ state: 'succeeded' })
    expect(provider.cancelled).toHaveLength(0)
  })

  /** 止めずに手を離すと、順番を返したあとで向こうが走り出し、次の動画と同時に GPU を使う。 */
  it('問い合わせが続けて失敗して諦めるときは、生成先を止めてから手を離す', async () => {
    const { job, deps, provider } = setup({ outcome: 'running' })
    const failing = {
      ...provider,
      poll: () => Promise.reject(new ProviderError('つながりません', ProviderId.parse('klein'), true)),
    }
    const result = await runImageJob({ ...deps, adapters: [{ provider: failing, model: codexCliImageModel }] }, { imageJobId: job.id })
    expect(result).toEqual({ state: 'failed' })
    expect(provider.cancelled).toHaveLength(1)
  })

  it('手元の GPU を名乗らない口（Codex）は順番を借りない', async () => {
    const { job, deps, provider } = setup()
    const lease = createInMemoryLocalGpuLease()
    const seenBySubmit: string[] = []
    const spying = {
      ...provider,
      submit: async (request: Parameters<typeof provider.submit>[0]) => {
        seenBySubmit.push((await lease.acquire('video-job', Date.now())).state)
        return provider.submit(request)
      },
    }
    await runImageJob({ ...deps, localGpuLease: lease, adapters: [{ provider: spying, model: codexCliImageModel }] }, { imageJobId: job.id })
    expect(seenBySubmit).toEqual(['acquired'])
  })

  it('投げ直しても二重に作らせないよう、ジョブの ID を鍵として渡す', async () => {
    const { job, deps, provider } = setup()
    await runImageJob(deps, { imageJobId: job.id })
    expect(provider.requests[0]?.idempotencyKey).toBe(job.id)
  })

  /** 使う AI は画面で選び直せる（ADR-0032）。worker は起動時の口ではなく、ジョブに記された口で作る。 */
  it('ジョブに記された口で作る', async () => {
    const { job, deps, provider } = setup()
    const other = { ...fakeImageProvider(dir), id: ProviderId.parse('stub-image') }
    const otherModel = { ...codexCliImageModel, providerId: ProviderId.parse('stub-image'), id: ModelId.parse('stub/gemini-like-image') }

    await runImageJob({ ...deps, adapters: [{ provider: other, model: otherModel }, { provider, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(provider.requests).toHaveLength(1)
    expect(other.requests).toHaveLength(0)
  })

  it('この環境に無い口のジョブは、理由を付けて失敗にする（作り直せない）', async () => {
    const { job, deps } = setup()

    const result = await runImageJob({ ...deps, adapters: [] }, { imageJobId: job.id })

    expect(result).toEqual({ state: 'failed' })
    expect((await deps.imageJobs.findById(job.id))?.error).toMatchObject({ code: 'provider_unavailable', retryable: false })
  })

  it('作った絵を素材として取り込み、最初のフレームを差し替える', async () => {
    const { job, deps } = setup()

    const result = await runImageJob(deps, { imageJobId: job.id })

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

    await runImageJob(deps, { imageJobId: job.id })

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

    await runImageJob({ ...deps, adapters: [{ provider: spying, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(resolved).not.toMatch(/^https?:/)
    expect((await deps.imageJobs.findById(job.id))?.referenceAssetIds).toEqual([referenceId])
  })

  it('失敗したら理由を残し、最初のフレームは変えない', async () => {
    const { job, deps } = setup({ outcome: { code: 'no_image', message: 'Codex CLI が絵を返しませんでした。' } })
    const previous: MediaAssetId = newId(MediaAssetIdSchema)
    await replaceManualStartFrame(deps.shotReferences, shot.id, previous)

    const result = await runImageJob(deps, { imageJobId: job.id })

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
    await runImageJob(ok.deps, { imageJobId: ok.job.id })
    const failing = setup({ outcome: { code: 'no_image', message: '絵が無い' } })
    await runImageJob(failing.deps, { imageJobId: failing.job.id })

    expect(ok.provider.released).toEqual(['job-1'])
    expect(failing.provider.released).toEqual(['job-1'])
  })

  it('始まった・終わったを出来事で知らせる', async () => {
    const { job, deps } = setup()

    await runImageJob(deps, { imageJobId: job.id })

    expect(deps.events.published().map((event) => (event.type === 'image_job.status' ? event.status : event.type))).toEqual([
      'running',
      'checking',
      'succeeded',
    ])
  })

  it('頼む前に断られても（大きさ違いなど）、理由を残して終える（投げっぱなしにしない）', async () => {
    const { job, deps, provider } = setup()
    const refusing = { ...provider, submit: () => Promise.reject(new Error('モデルでは次の要求を満たせません')) }

    const result = await runImageJob({ ...deps, adapters: [{ provider: refusing, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(result.state).toBe('failed')
    expect((await deps.imageJobs.findById(job.id))?.error?.message).toContain('満たせません')
  })

  it('もう終わったジョブはやり直さない', async () => {
    const { job, deps, provider } = setup()
    await runImageJob(deps, { imageJobId: job.id })

    const again = await runImageJob(deps, { imageJobId: job.id })

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

    const result = await runImageJob(deps, { imageJobId: job.id })

    expect(result).toEqual({ state: 'skipped' })
    expect(provider.requests).toHaveLength(0)
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('cancelled')
  })

  it('手元の GPU の順番待ちの間に止めたら、次に拾ったとき券を列から外す（後ろの GPU の仕事を待たせない）', async () => {
    const { job, deps, provider } = setup()
    const lease = createInMemoryLocalGpuLease()
    await lease.acquire('video-job', job.queuedAt.getTime() - 1000)
    const local = {
      ...deps,
      localGpuLease: lease,
      adapters: [{ provider: { ...provider, exclusiveResource: 'local-gpu' as const }, model: codexCliImageModel }],
    }
    expect(await runImageJob(local, { imageJobId: job.id })).toEqual({ state: 'waiting' })

    await deps.imageJobs.cancelActive({ projectId: project.id })
    expect(await runImageJob(local, { imageJobId: job.id })).toEqual({ state: 'skipped' })

    await lease.release('video-job')
    expect(await lease.acquire('later-video', job.queuedAt.getTime() + 60_000)).toEqual({ state: 'acquired' })
    expect(provider.requests).toHaveLength(0)
  })

  it('作っている途中で止めたら、生成先へ止めてと頼み、最初のフレームは変えない', async () => {
    const { job, deps, provider } = setup({ outcome: 'running' })
    // 生成先が作っている間（見に行ったとき）に止める。
    const poll = provider.poll.bind(provider)
    const stopping = { ...provider, poll: async (handle: Parameters<typeof poll>[0]) => {
      await deps.imageJobs.cancelActive({ projectId: project.id, shotIds: [shot.id] })
      return poll(handle)
    } }

    const result = await runImageJob({ ...deps, adapters: [{ provider: stopping, model: codexCliImageModel }] }, { imageJobId: job.id })

    expect(result).toEqual({ state: 'skipped' })
    expect(provider.cancelled).toEqual(['job-1'])
    expect(provider.released).toEqual(['job-1'])
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBeNull()
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('cancelled')
  })

  it('絵が届いた後、差し替える前に止めたら、差し替えない', async () => {
    const { job, deps } = setup()
    const crop = deps.crop
    const result = await runImageJob(
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
