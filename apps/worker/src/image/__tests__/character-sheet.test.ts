import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ModelId,
  ProviderId,
  newId,
  type Character,
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
import { processImageJob, type ImageProcessorDeps } from '../processor.js'
import { FAKE_PNG, fakeImageProvider } from './doubles.js'

/**
 * 手本の画像 1 枚からキャラクターシート（四面図）を作る（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式の
 * キャラクターシートを 1 枚の画像から作れるといい」）。絵コンテの画像と同じジョブ・同じ順番待ちで、種類で分ける。
 * できたシートは識別画像の四面図に足す。**プロジェクトの比には切り抜かない**（4 つの全身が欠ける）。
 */

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-character-sheet-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = aProject()

const setup = async (
  options: { outcome?: Parameters<typeof fakeImageProvider>[1]; existingSheet?: boolean } = {},
) => {
  const storage = createMemoryStorage()
  const mediaAssets = inMemoryMediaAssets()
  const front = await mediaAssets.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'image',
    storageKey: mediaKey(project.workspaceId, newId(ImageGenerationJobIdSchema), 'png'),
    mimeType: 'image/png',
    bytes: FAKE_PNG.byteLength,
    checksumSha256: 'a'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'tester' },
  })
  await storage.put(front.storageKey, FAKE_PNG, { contentType: 'image/png' })
  const characters = createInMemoryCharacterRepository()
  const character: Character = await characters.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    name: 'takepi',
    displayName: '藤本タケピ',
    identityAnchors: ['切れ長の目'],
  })
  await characters.addIdentityImage({ characterId: character.id, mediaAssetId: front.id, role: 'full_body', isPrimary: true, order: 0 })
  if (options.existingSheet === true) {
    await characters.addIdentityImage({ characterId: character.id, mediaAssetId: front.id, role: 'four_view', isPrimary: true, order: 1 })
  }
  const job: ImageGenerationJob = {
    id: newId(ImageGenerationJobIdSchema),
    projectId: project.id,
    kind: 'character_sheet',
    shotId: null,
    characterId: character.id,
    status: 'queued',
    providerId: ProviderId.parse('codex-cli'),
    modelId: ModelId.parse('codex-cli/image-gen'),
    referenceAssetIds: [front.id],
    mediaAssetId: null,
    error: null,
    providerRecord: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
  }
  const provider = fakeImageProvider(dir, options.outcome)
  const crops: string[] = []
  const deps = {
    imageJobs: createInMemoryImageJobRepository([job]),
    shots: inMemoryShots([]),
    projects: inMemoryProjects([project]),
    characters,
    mediaAssets,
    shotReferences: createInMemoryShotReferenceRepository(),
    storage,
    context: {
      charactersForShot: () => Promise.resolve([]),
      locationsForShot: () => Promise.resolve([]),
      manualReferencesForShot: () => Promise.resolve([]),
      previousShotLastFrame: () => Promise.resolve(null),
      startFrame: () => Promise.resolve(null),
    },
    adapters: [{ provider, model: codexCliImageModel }],
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    workDir: join(dir, 'work'),
    logger: silentLogger,
    pollIntervalMs: 1,
    crop: (input: string) => {
      crops.push(input)
      return Promise.resolve({ width: 1536, height: 864 })
    },
  } satisfies ImageProcessorDeps
  return { job, deps, provider, character, front, crops }
}

describe('キャラクターシートのジョブ', () => {
  it('手本を subject に、四面図の指示で横長に作り、切り抜かずに識別画像の四面図（主）として足す', async () => {
    const f = await setup()

    const result = await processImageJob(f.deps, { imageJobId: f.job.id })

    expect(result).toEqual({ state: 'succeeded' })
    const [request] = f.provider.requests
    expect(request?.prompt).toMatch(/キャラクターシート（四面図）/)
    expect(request?.prompt).toContain('切れ長の目')
    expect(request?.references).toEqual([{ mediaAssetId: f.front.id, role: 'subject' }])
    expect(request?.composition).toBe('sheet')
    expect((request?.resolution.width ?? 0) > (request?.resolution.height ?? 0)).toBe(true)
    expect(f.crops).toEqual([])

    const done = await f.deps.imageJobs.findById(f.job.id)
    const sheet = (await f.deps.characters.listIdentityImages(f.character.id)).find((image) => image.role === 'four_view')
    expect(sheet).toMatchObject({ mediaAssetId: done?.mediaAssetId, isPrimary: true })
    expect(f.deps.events.published().map((event) => event.type === 'image_job.status' && event.characterId)).toContain(f.character.id)
  })

  it('四面図の主がもうあれば、新しいシートは主にしない（足していく）', async () => {
    const f = await setup({ existingSheet: true })

    await processImageJob(f.deps, { imageJobId: f.job.id })

    const sheets = (await f.deps.characters.listIdentityImages(f.character.id)).filter((image) => image.role === 'four_view')
    expect(sheets.map((image) => image.isPrimary)).toEqual([true, false])
  })

  it('作れなければ理由を残し、識別画像は変えない', async () => {
    const f = await setup({ outcome: { code: 'no_image', message: 'Codex CLI が絵を返しませんでした。' } })

    expect(await processImageJob(f.deps, { imageJobId: f.job.id })).toEqual({ state: 'failed' })
    expect((await f.deps.imageJobs.findById(f.job.id))?.error?.message).toMatch(/絵を返しませんでした/)
    expect((await f.deps.characters.listIdentityImages(f.character.id)).map((image) => image.role)).toEqual(['full_body'])
  })

  it('キャラクターが消されていたら、理由を付けて失敗にする', async () => {
    const f = await setup()
    await f.deps.characters.softDelete(f.character.id)

    expect(await processImageJob(f.deps, { imageJobId: f.job.id })).toEqual({ state: 'failed' })
    expect((await f.deps.imageJobs.findById(f.job.id))?.error?.code).toBe('character_missing')
  })
})
