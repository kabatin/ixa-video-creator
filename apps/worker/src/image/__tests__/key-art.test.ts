import { createInMemoryLocalGpuLease } from '../../generation/local-gpu-lease.js'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ModelId,
  ProviderId,
  newId,
  type AspectRatio,
  type ImageGenerationJob,
} from '@ixa/domain'
import {
  createInMemoryCharacterRepository,
  createInMemoryImageJobRepository,
  createInMemoryShotReferenceRepository,
} from '@ixa/generation/testing'
import { codexCliImageModel } from '@ixa/provider-image'
import { createMemoryStorage, mediaKey } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aProject,
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
 * サムネイルの背景（キーアート。ADR-0051）。作品にだけ属する絵のジョブ。
 * 作品の方針・登場人物の顔を参照にして横長で作り、16:9 に切り抜いて素材にする。最初のフレームも識別画像も変えない。
 */

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-key-art-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = { ...aProject(), styleGuide: 'ネオンの夜', avoid: '血' }

const setup = async (options: { outcome?: Parameters<typeof fakeImageProvider>[1]; withProject?: boolean } = {}) => {
  const storage = createMemoryStorage()
  const mediaAssets = inMemoryMediaAssets()
  const face = await mediaAssets.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'image',
    storageKey: mediaKey(project.workspaceId, newId(ImageGenerationJobIdSchema), 'png'),
    mimeType: 'image/png',
    bytes: FAKE_PNG.byteLength,
    checksumSha256: 'b'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'tester' },
  })
  await storage.put(face.storageKey, FAKE_PNG, { contentType: 'image/png' })
  const characters = createInMemoryCharacterRepository()
  const character = await characters.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    name: 'haruto',
    displayName: 'はると',
    identityAnchors: ['黒髪'],
  })
  await characters.addIdentityImage({ characterId: character.id, mediaAssetId: face.id, role: 'face_front', isPrimary: true, order: 0 })
  const job: ImageGenerationJob = {
    id: newId(ImageGenerationJobIdSchema),
    projectId: project.id,
    kind: 'key_art',
    shotId: null,
    characterId: null,
    status: 'queued',
    instruction: '夕焼けの屋上',
    providerId: ProviderId.parse('codex-cli'),
    modelId: ModelId.parse('codex-cli/image-gen'),
    referenceAssetIds: [],
    mediaAssetId: null,
    error: null,
    providerRecord: null,
    sentPrompt: null,
    retryOfJobId: null,
    attempt: 1,
    appliedAt: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
  }
  const provider = fakeImageProvider(dir, options.outcome)
  const crops: AspectRatio[] = []
  const deps = {
    ...checkDeps(),
    imageJobs: createInMemoryImageJobRepository([job]),
    shots: inMemoryShots([]),
    projects: inMemoryProjects(options.withProject === false ? [] : [project]),
    characters,
    concept: () => Promise.resolve('大会に挑む 3 人'),
    mediaAssets,
    shotReferences: createInMemoryShotReferenceRepository(),
    storage,
    context: {
      charactersForShot: () => Promise.resolve([]),
      speakersForShot: () => Promise.resolve([]),
      locationsForShot: () => Promise.resolve([]),
      manualReferencesForShot: () => Promise.resolve([]),
      previousShotLastFrame: () => Promise.resolve(null),
      startFrame: () => Promise.resolve(null),
    },
    adapters: [{ provider, model: codexCliImageModel }],
    localGpuLease: createInMemoryLocalGpuLease(),
    scheduler: { reschedule: () => Promise.resolve() },
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    workDir: join(dir, 'work'),
    logger: silentLogger,
    pollIntervalMs: 1,
    crop: async (input: string, output: string, aspect: AspectRatio) => {
      crops.push(aspect)
      await copyFile(input, output)
      return { width: 1536, height: 864 }
    },
  } satisfies ImageProcessorDeps
  return { job, deps, provider, face, crops, characters, character }
}

describe('キーアートのジョブ', () => {
  it('作品の方針・人物・指示から横長で作り、16:9 に切り抜いて素材にする', async () => {
    const f = await setup()

    const result = await runImageJob(f.deps, { imageJobId: f.job.id })
    expect((await f.deps.imageJobs.findById(f.job.id))?.error).toBeNull()
    expect(result).toEqual({ state: 'succeeded' })

    const [request] = f.provider.requests
    expect(request?.prompt).toContain('YouTube サムネイル')
    expect(request?.prompt).toContain('はると: 黒髪')
    expect(request?.prompt).toContain('大会に挑む 3 人')
    expect(request?.prompt).toContain('ネオンの夜')
    expect(request?.prompt).toContain('夕焼けの屋上')
    expect(request?.references).toEqual([{ mediaAssetId: f.face.id, role: 'subject' }])
    expect((request?.resolution.width ?? 0) > (request?.resolution.height ?? 0)).toBe(true)
    expect(f.crops).toEqual(['16:9'])

    const done = await f.deps.imageJobs.findById(f.job.id)
    expect(done).toMatchObject({ status: 'succeeded', referenceAssetIds: [f.face.id] })
    const asset = done?.mediaAssetId === null || done === null ? null : await f.deps.mediaAssets.findById(done.mediaAssetId)
    expect(asset?.origin).toEqual({ type: 'generated_image', imageJobId: f.job.id })
    expect(f.deps.mediaQueue.enqueued()).toEqual([done?.mediaAssetId])
    // 識別画像は変えない（候補の 1 枚を足すだけ）。
    expect((await f.characters.listIdentityImages(f.character.id)).map((image) => image.role)).toEqual(['face_front'])
    const statuses = f.deps.events.published().flatMap((event) => (event.type === 'image_job.status' ? [event.status] : []))
    expect(statuses).toEqual(['running', 'checking', 'succeeded'])
  })

  it('作れなければ理由を残す', async () => {
    const f = await setup({ outcome: { code: 'no_image', message: 'Codex CLI が絵を返しませんでした。' } })

    expect(await runImageJob(f.deps, { imageJobId: f.job.id })).toEqual({ state: 'failed' })
    expect((await f.deps.imageJobs.findById(f.job.id))?.error?.message).toMatch(/絵を返しませんでした/)
  })

  it('作品が消されていたら、理由を付けて失敗にする', async () => {
    const f = await setup({ withProject: false })

    expect(await runImageJob(f.deps, { imageJobId: f.job.id })).toEqual({ state: 'failed' })
    expect((await f.deps.imageJobs.findById(f.job.id))?.error?.code).toBe('project_missing')
    expect(f.provider.requests).toEqual([])
  })
})
