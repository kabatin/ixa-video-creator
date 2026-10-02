import type { ImageJobRepository } from '@ixa/db'
import {
  ImageGenerationJob as ImageGenerationJobSchema,
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  imageJobViolation,
  newId,
  type ImageGenerationJob,
} from '@ixa/domain'

/** 絵のジョブ（最初のフレーム・キャラクターシート）のインメモリ版。書くたびに状態と中身の食い違いを確かめる（実物と同じ）。 */
export type InMemoryImageJobRepository = ImageJobRepository & { readonly snapshot: () => readonly ImageGenerationJob[] }

export const createInMemoryImageJobRepository = (
  seed: readonly ImageGenerationJob[] = [],
): InMemoryImageJobRepository => {
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
            id: newId(ImageGenerationJobIdSchema),
            projectId: input.projectId,
            kind: input.kind,
            shotId: input.kind === 'start_frame' ? input.shotId : null,
            characterId: input.kind === 'character_sheet' ? input.characterId : null,
            providerId: input.providerId,
            modelId: input.modelId,
            status: 'queued',
            referenceAssetIds: input.kind === 'character_sheet' ? [...input.referenceAssetIds] : [],
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
    findActiveByCharacter: (characterId) =>
      Promise.resolve(newestFirst(store.filter((job) => job.characterId === characterId && active(job)))[0] ?? null),
    findLatestByCharacter: (characterId) =>
      Promise.resolve(newestFirst(store.filter((job) => job.characterId === characterId))[0] ?? null),
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
