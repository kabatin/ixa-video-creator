import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageJobRepository } from '@ixa/db'
import {
  ImageGenerationJob as ImageGenerationJobSchema,
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  imageJobViolation,
  newId,
  type ImageGenerationJob,
} from '@ixa/domain'
import type { ImageGenerationRequest, ImageJobStatus, ImageProvider } from '@ixa/provider-core'
import { codexCliImageModel } from '@ixa/provider-image'

/** 絵コンテの画像ジョブのインメモリ版。書くたびに状態と中身の食い違いを確かめる（実物と同じ）。 */
export type InMemoryImageJobs = ImageJobRepository & { readonly snapshot: () => readonly ImageGenerationJob[] }

export const inMemoryImageJobs = (seed: readonly ImageGenerationJob[] = []): InMemoryImageJobs => {
  let store: readonly ImageGenerationJob[] = seed
  const save = (job: ImageGenerationJob): ImageGenerationJob => {
    const violation = imageJobViolation(job)
    if (violation !== null) throw new Error(violation)
    store = [...store.filter((candidate) => candidate.id !== job.id), job]
    return job
  }
  const get = (id: ImageGenerationJob['id']): ImageGenerationJob => {
    const job = store.find((candidate) => candidate.id === id)
    if (job === undefined) throw new Error(`ジョブがありません: ${id}`)
    return job
  }
  const active = (job: ImageGenerationJob) => job.status === 'queued' || job.status === 'running'
  const newestFirst = (jobs: readonly ImageGenerationJob[]) => [...jobs].sort((a, b) => b.id.localeCompare(a.id))
  return {
    snapshot: () => store,
    create: (input) =>
      Promise.resolve(
        save(
          ImageGenerationJobSchema.parse({
            ...input,
            id: newId(ImageGenerationJobIdSchema),
            status: 'queued',
            referenceAssetIds: [],
            mediaAssetId: null,
            error: null,
            providerRecord: null,
            queuedAt: new Date(),
            startedAt: null,
            finishedAt: null,
          }),
        ),
      ),
    findById: (id) => Promise.resolve(store.find((job) => job.id === id) ?? null),
    findActiveByShot: (shotId) =>
      Promise.resolve(newestFirst(store.filter((job) => job.shotId === shotId && active(job)))[0] ?? null),
    findLatestByShot: (shotId) => Promise.resolve(newestFirst(store.filter((job) => job.shotId === shotId))[0] ?? null),
    findActiveByProject: (projectId) =>
      Promise.resolve(newestFirst(store.filter((job) => job.projectId === projectId && active(job)))),
    markRunning: (id, referenceAssetIds) =>
      Promise.resolve(save({ ...get(id), status: 'running', referenceAssetIds: [...referenceAssetIds], startedAt: new Date() })),
    markSucceeded: (id, mediaAssetId, providerRecord) =>
      Promise.resolve(save({ ...get(id), status: 'succeeded', mediaAssetId, providerRecord, finishedAt: new Date() })),
    markFailed: (id, error, providerRecord) =>
      Promise.resolve(save({ ...get(id), status: 'failed', error, providerRecord, finishedAt: new Date() })),
  }
}

/** 1 PNG 相当の中身（切り抜きは差し替えるので、本物の画像である必要はない）。 */
export const FAKE_PNG = Buffer.from('89504e470d0a1a0a0000', 'hex')

export type FakeImageProvider = ImageProvider & { readonly requests: ImageGenerationRequest[] }

/** 要求を覚え、`outcome` どおりに終わる偽の画像 Provider。成功なら `outputDir` に PNG を書く。 */
export const fakeImageProvider = (
  outputDir: string,
  outcome: 'succeeded' | { readonly code: string; readonly message: string } = 'succeeded',
): FakeImageProvider => {
  const requests: ImageGenerationRequest[] = []
  const statuses = new Map<string, ImageJobStatus>()
  return {
    id: codexCliImageModel.providerId,
    models: [codexCliImageModel],
    requests,
    submit: async (request) => {
      requests.push(request)
      // 実物と同じく、参照はここで手元のパスへ解決される。
      await Promise.all(request.references.map((reference) => request.resolveReference(reference.mediaAssetId)))
      const ref = `job-${String(requests.length)}`
      if (outcome === 'succeeded') {
        const path = join(outputDir, `${ref}.png`)
        await writeFile(path, FAKE_PNG)
        statuses.set(ref, {
          state: 'succeeded',
          outputs: [{ type: 'local', path }],
          seedUsed: null,
          costUsd: 0,
          raw: { kind: 'cli', cliVersion: 'codex-cli 0.154.0', exitCode: 0 },
        })
      } else {
        statuses.set(ref, { state: 'failed', error: { ...outcome, retryable: true } })
      }
      return { providerId: codexCliImageModel.providerId, modelId: codexCliImageModel.id, ref, submittedAt: new Date() }
    },
    poll: (handle) => Promise.resolve(statuses.get(handle.ref) ?? { state: 'running', progress: null }),
    cancel: () => Promise.resolve(),
  }
}
