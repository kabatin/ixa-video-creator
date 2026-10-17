import { DbNotFoundError, type SfxJobRepository } from '@ixa/db'
import { SfxJob, SfxJobId, newId } from '@ixa/domain'

/** 効果音を作るジョブ（ADR-0052）の偽物。止めた行は上書きしない（実物と同じ）。 */
export const createInMemorySfxJobRepository = (): SfxJobRepository & { readonly snapshot: () => readonly SfxJob[] } => {
  let store: readonly SfxJob[] = []
  const replace = (id: string, patch: Partial<SfxJob>): Promise<SfxJob> => {
    const current = store.find((job) => job.id === id)
    if (current === undefined) return Promise.reject(new DbNotFoundError('sfx_jobs', id))
    if (current.status === 'cancelled') return Promise.resolve(current)
    const updated = SfxJob.parse({ ...current, ...patch })
    store = store.map((job) => (job.id === id ? updated : job))
    return Promise.resolve(updated)
  }
  const active = (job: SfxJob) => job.status === 'queued' || job.status === 'running'
  return {
    snapshot: () => store,
    create: (input) => {
      const created = SfxJob.parse({
        id: newId(SfxJobId),
        projectId: input.projectId,
        tool: input.tool,
        model: input.model,
        spec: input.spec,
        status: 'queued',
        error: null,
        providerRecord: null,
        mediaAssetIds: [],
        timelineClipId: null,
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
    findById: (id) => Promise.resolve(store.find((job) => job.id === id) ?? null),
    findRecentByProject: (projectId, limit) =>
      Promise.resolve([...store].reverse().filter((job) => job.projectId === projectId).slice(0, limit)),
    findActiveByProject: (projectId) =>
      Promise.resolve([...store].reverse().filter((job) => job.projectId === projectId && active(job))),
    cancelActive: (projectId) => {
      const targets = store.filter((job) => job.projectId === projectId && active(job)).map((job) => job.id)
      store = store.map((job) => (targets.includes(job.id) ? { ...job, status: 'cancelled' as const, finishedAt: new Date() } : job))
      return Promise.resolve(store.filter((job) => targets.includes(job.id)))
    },
    markRunning: (id) => replace(id, { status: 'running', startedAt: new Date() }),
    recordProvider: (id, providerRecord) => replace(id, { providerRecord }),
    markSucceeded: (id, outcome) =>
      replace(id, {
        status: 'succeeded',
        finishedAt: new Date(),
        mediaAssetIds: [...outcome.mediaAssetIds],
        timelineClipId: outcome.timelineClipId,
        providerRecord: outcome.providerRecord,
      }),
    markFailed: (id, error, providerRecord) =>
      replace(id, { status: 'failed', finishedAt: new Date(), error, ...(providerRecord === null ? {} : { providerRecord }) }),
  }
}
