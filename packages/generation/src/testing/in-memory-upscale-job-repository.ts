import type { UpscaleJobRepository } from '@ixa/db'
import {
  UpscaleJob as UpscaleJobSchema,
  UpscaleJobId as UpscaleJobIdSchema,
  newId,
  upscaleJobViolation,
  type UpscaleJob,
} from '@ixa/domain'

/**
 * 解像度を上げるジョブ（ADR-0044）のインメモリ版。
 * **書くたびに状態と中身の食い違いを確かめる**（実物と同じ）。
 */
export type InMemoryUpscaleJobRepository = UpscaleJobRepository & {
  readonly snapshot: () => readonly UpscaleJob[]
}

export const createInMemoryUpscaleJobRepository = (
  seed: readonly UpscaleJob[] = [],
): InMemoryUpscaleJobRepository => {
  let store: readonly UpscaleJob[] = seed
  const save = (job: UpscaleJob): UpscaleJob => {
    const violation = upscaleJobViolation(job)
    if (violation !== null) throw new Error(violation)
    store = [...store.filter((candidate) => candidate.id !== job.id), job]
    return job
  }
  const get = (id: UpscaleJob['id']): UpscaleJob => {
    const job = store.find((candidate) => candidate.id === id)
    if (job === undefined) throw new Error(`ジョブがありません: ${id}`)
    return job
  }
  const active = (job: UpscaleJob): boolean => job.status === 'queued' || job.status === 'running'
  /** 止めた行は上書きしない（実物と同じ）。止めた行をそのまま返す。 */
  const transition = (id: UpscaleJob['id'], patch: Partial<UpscaleJob>): UpscaleJob => {
    const current = get(id)
    return current.status === 'cancelled' ? current : save({ ...current, ...patch })
  }

  return {
    snapshot: () => store,
    create: (input) =>
      Promise.resolve(
        save(
          UpscaleJobSchema.parse({
            id: newId(UpscaleJobIdSchema),
            projectId: input.projectId,
            shotId: input.shotId,
            sourceTakeId: input.sourceTakeId,
            providerId: input.providerId,
            modelId: input.modelId,
            status: 'queued',
            takeId: null,
            providerJobRef: null,
            error: null,
            estimateSeconds: null,
            providerRecord: null,
            queuedAt: new Date(),
            startedAt: null,
            finishedAt: null,
          }),
        ),
      ),
    findById: (id) => Promise.resolve(store.find((job) => job.id === id) ?? null),
    findActiveByProject: (projectId) =>
      Promise.resolve(store.filter((job) => job.projectId === projectId && active(job))),
    findLatestByShot: (shotId) =>
      Promise.resolve(
        [...store].filter((job) => job.shotId === shotId).sort((a, b) => b.id.localeCompare(a.id))[0] ?? null,
      ),
    cancelActive: ({ projectId, shotIds }) => {
      if (shotIds !== undefined && shotIds.length === 0) return Promise.resolve([])
      const targets = store.filter(
        (job) =>
          job.projectId === projectId &&
          active(job) &&
          (shotIds === undefined || shotIds.includes(job.shotId)),
      )
      return Promise.resolve(
        targets.map((job) => save({ ...job, status: 'cancelled', finishedAt: new Date() })),
      )
    },
    markRunning: (id, input) =>
      Promise.resolve(
        transition(id, {
          status: 'running',
          providerJobRef: input.providerJobRef,
          estimateSeconds: input.estimateSeconds,
          providerRecord: input.providerRecord,
          startedAt: new Date(),
        }),
      ),
    markSucceeded: (id, takeId, providerRecord) =>
      Promise.resolve(transition(id, { status: 'succeeded', takeId, providerRecord, finishedAt: new Date() })),
    markFailed: (id, error, providerRecord) =>
      Promise.resolve(transition(id, { status: 'failed', error, providerRecord, finishedAt: new Date() })),
  }
}
