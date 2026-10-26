import type { DubJobRepository, TtsClip, TtsClipRepository } from '@ixa/db'
import {
  DubJob as DubJobSchema,
  DubJobId as DubJobIdSchema,
  TtsClipId as TtsClipIdSchema,
  dubJobViolation,
  newId,
  type DubJob,
} from '@ixa/domain'

/**
 * 声の差し替え（ADR-0062）のジョブと読み上げの保存のインメモリ版。
 * **書くたびに状態と中身の食い違いを確かめ、止めた行は上書きしない**（実物と同じ）。
 */
export type InMemoryDubJobRepository = DubJobRepository & { readonly snapshot: () => readonly DubJob[] }

export const createInMemoryDubJobRepository = (seed: readonly DubJob[] = []): InMemoryDubJobRepository => {
  let store: readonly DubJob[] = seed
  const save = (job: DubJob): DubJob => {
    const violation = dubJobViolation(job)
    if (violation !== null) throw new Error(violation)
    store = [...store.filter((candidate) => candidate.id !== job.id), job]
    return job
  }
  const get = (id: DubJob['id']): DubJob => {
    const job = store.find((candidate) => candidate.id === id)
    if (job === undefined) throw new Error(`ジョブがありません: ${id}`)
    return job
  }
  const active = (job: DubJob): boolean => job.status === 'queued' || job.status === 'running'
  const transition = (id: DubJob['id'], patch: Partial<DubJob>): DubJob => {
    const current = get(id)
    return current.status === 'cancelled' ? current : save({ ...current, ...patch })
  }
  const newest = (jobs: readonly DubJob[]): DubJob[] => [...jobs].sort((a, b) => b.id.localeCompare(a.id))

  return {
    create: (input) =>
      Promise.resolve(
        save(
          DubJobSchema.parse({
            id: newId(DubJobIdSchema),
            ...input,
            status: 'queued',
            takeId: null,
            costUsd: 0,
            error: null,
            record: null,
            queuedAt: new Date(),
            startedAt: null,
            finishedAt: null,
          }),
        ),
      ),
    findById: (id) => Promise.resolve(store.find((job) => job.id === id) ?? null),
    findActiveByProject: (projectId) => Promise.resolve(newest(store.filter((job) => job.projectId === projectId && active(job)))),
    findLatestByShot: (shotId) => Promise.resolve(newest(store.filter((job) => job.shotId === shotId))[0] ?? null),
    cancel: (id) => {
      const current = get(id)
      return Promise.resolve(active(current) ? save({ ...current, status: 'cancelled', finishedAt: new Date() }) : current)
    },
    markRunning: (id) => Promise.resolve(transition(id, { status: 'running', startedAt: new Date() })),
    markSucceeded: (id, input) =>
      Promise.resolve(transition(id, { status: 'succeeded', takeId: input.takeId, costUsd: input.costUsd, record: input.record, finishedAt: new Date() })),
    markFailed: (id, error, costUsd) => Promise.resolve(transition(id, { status: 'failed', error, costUsd, finishedAt: new Date() })),
    snapshot: () => store,
  }
}

export type InMemoryTtsClipRepository = TtsClipRepository & { readonly snapshot: () => readonly TtsClip[] }

export const createInMemoryTtsClipRepository = (seed: readonly TtsClip[] = []): InMemoryTtsClipRepository => {
  let store: readonly TtsClip[] = seed
  return {
    findByKey: (workspaceId, cacheKey) =>
      Promise.resolve(store.find((clip) => clip.workspaceId === workspaceId && clip.cacheKey === cacheKey) ?? null),
    // 実物と同じく、同じワークスペース・同じ鍵なら素材・長さ・額を書き替える（1 行のまま）。
    save: (input) => {
      const existing = store.find((clip) => clip.workspaceId === input.workspaceId && clip.cacheKey === input.cacheKey)
      const clip: TtsClip =
        existing === undefined
          ? { ...input, id: newId(TtsClipIdSchema), createdAt: new Date() }
          : { ...existing, mediaAssetId: input.mediaAssetId, durationSec: input.durationSec, costUsd: input.costUsd }
      store = [...store.filter((other) => other.id !== clip.id), clip]
      return Promise.resolve(clip)
    },
    snapshot: () => store,
  }
}
