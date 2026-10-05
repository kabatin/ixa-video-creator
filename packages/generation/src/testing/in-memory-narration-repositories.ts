import type {
  NarrationLineRepository,
  NarrationTakeRepository,
  ProjectAudioSettingsRepository,
  VoiceJobRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import { DbNotFoundError } from '@ixa/db'
import {
  CreateNarrationLineInput,
  CreateVoiceProfileInput,
  NarrationLine,
  NarrationLineId,
  NarrationTake,
  NarrationTakeId,
  ProjectAudioSettings,
  UpdateNarrationLinePatch,
  UpdateVoiceProfilePatch,
  VoiceJob,
  VoiceJobId,
  VoiceProfile,
  VoiceProfileId,
  defaultAudioSettings,
  newId,
} from '@ixa/domain'

/**
 * ナレーションと声（ADR-0038）のリポジトリのメモリ版。実 DB と同じく、論理削除した行は一覧から外れ、
 * 止めたジョブは上書きしない。
 */

export const createInMemoryVoiceProfileRepository = (): VoiceProfileRepository & { readonly snapshot: () => readonly VoiceProfile[] } => {
  let store: readonly VoiceProfile[] = []
  const find = (id: string) => store.find((voice) => voice.id === id)
  return {
    snapshot: () => store,
    findByProject: (projectId) => Promise.resolve(store.filter((voice) => voice.projectId === projectId)),
    findById: (id) => Promise.resolve(find(id) ?? null),
    findByName: (projectId, name) =>
      Promise.resolve(store.find((voice) => voice.projectId === projectId && voice.name === name.trim()) ?? null),
    create: (input) => {
      const now = new Date()
      const created = VoiceProfile.parse({ ...CreateVoiceProfileInput.parse(input), id: newId(VoiceProfileId), createdAt: now, updatedAt: now })
      store = [...store, created]
      return Promise.resolve(created)
    },
    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('voice_profiles', id))
      const updated = VoiceProfile.parse({ ...current, ...UpdateVoiceProfilePatch.parse(patch), updatedAt: new Date() })
      store = store.map((voice) => (voice.id === id ? updated : voice))
      return Promise.resolve(updated)
    },
    softDelete: (id) => {
      if (find(id) === undefined) return Promise.reject(new DbNotFoundError('voice_profiles', id))
      store = store.filter((voice) => voice.id !== id)
      return Promise.resolve()
    },
  }
}

export const createInMemoryNarrationLineRepository = (): NarrationLineRepository & { readonly snapshot: () => readonly NarrationLine[] } => {
  let store: readonly NarrationLine[] = []
  const find = (id: string) => store.find((line) => line.id === id)
  const ordered = (lines: readonly NarrationLine[]) => [...lines].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return {
    snapshot: () => store,
    findByProject: (projectId) => Promise.resolve(ordered(store.filter((line) => line.projectId === projectId))),
    findById: (id) => Promise.resolve(find(id) ?? null),
    createMany: (inputs) => {
      const now = new Date()
      const created = inputs.map((input) =>
        NarrationLine.parse({ ...CreateNarrationLineInput.parse(input), id: newId(NarrationLineId), selectedTakeId: null, createdAt: now, updatedAt: now }),
      )
      store = [...store, ...created]
      return Promise.resolve(created)
    },
    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('narration_lines', id))
      const updated = NarrationLine.parse({ ...current, ...UpdateNarrationLinePatch.parse(patch), updatedAt: new Date() })
      store = store.map((line) => (line.id === id ? updated : line))
      return Promise.resolve(updated)
    },
    reorder: (projectId, ids) => {
      store = store.map((line) => {
        const index = ids.indexOf(line.id)
        return line.projectId === projectId && index >= 0 ? { ...line, order: index } : line
      })
      return Promise.resolve(ordered(store.filter((line) => ids.includes(line.id))))
    },
    softDelete: (id) => {
      if (find(id) === undefined) return Promise.reject(new DbNotFoundError('narration_lines', id))
      store = store.filter((line) => line.id !== id)
      return Promise.resolve()
    },
  }
}

export const createInMemoryNarrationTakeRepository = (): NarrationTakeRepository & { readonly snapshot: () => readonly NarrationTake[] } => {
  let store: readonly NarrationTake[] = []
  return {
    snapshot: () => store,
    findById: (id) => Promise.resolve(store.find((take) => take.id === id) ?? null),
    findByLines: (lineIds) =>
      Promise.resolve(store.filter((take) => lineIds.includes(take.lineId)).sort((a, b) => a.index - b.index)),
    findLatestBySpecHash: (lineId, specHash) =>
      Promise.resolve(
        [...store].reverse().find((take) => take.lineId === lineId && take.specHash === specHash) ?? null,
      ),
    create: (input) => {
      const index = store.filter((take) => take.lineId === input.lineId).length + 1
      const created = NarrationTake.parse({ ...input, id: newId(NarrationTakeId), index, createdAt: new Date() })
      store = [...store, created]
      return Promise.resolve(created)
    },
    setCharTimes: (id, charTimes) => {
      const current = store.find((take) => take.id === id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('narration_takes', id))
      const updated = { ...current, charTimes: [...charTimes] }
      store = store.map((take) => (take.id === id ? updated : take))
      return Promise.resolve(updated)
    },
  }
}

export const createInMemoryVoiceJobRepository = (): VoiceJobRepository & { readonly snapshot: () => readonly VoiceJob[] } => {
  let store: readonly VoiceJob[] = []
  const replace = (id: string, patch: Partial<VoiceJob>): Promise<VoiceJob> => {
    const current = store.find((job) => job.id === id)
    if (current === undefined) return Promise.reject(new DbNotFoundError('voice_jobs', id))
    if (current.status === 'cancelled') return Promise.resolve(current)
    const updated = VoiceJob.parse({ ...current, ...patch })
    store = store.map((job) => (job.id === id ? updated : job))
    return Promise.resolve(updated)
  }
  const active = (job: VoiceJob) => job.status === 'queued' || job.status === 'running'
  return {
    snapshot: () => store,
    create: (input) => {
      const created = VoiceJob.parse({
        id: newId(VoiceJobId),
        projectId: input.projectId,
        kind: input.kind,
        lineId: 'lineId' in input ? input.lineId : null,
        takeId: 'takeId' in input ? input.takeId : null,
        voiceProfileId: 'voiceProfileId' in input ? input.voiceProfileId : null,
        inputMediaAssetId: 'inputMediaAssetId' in input ? input.inputMediaAssetId : null,
        resultMediaAssetId: null,
        placeAtSec: 'placeAtSec' in input ? input.placeAtSec : null,
        tool: input.tool,
        model: input.model,
        spec: 'spec' in input ? input.spec : null,
        status: 'queued',
        costUsd: null,
        error: null,
        providerRecord: null,
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
    findById: (id) => Promise.resolve(store.find((job) => job.id === id) ?? null),
    findActiveByProject: (projectId) => Promise.resolve(store.filter((job) => job.projectId === projectId && active(job))),
    findLatestByLines: (lineIds) =>
      Promise.resolve(
        lineIds.flatMap((lineId) => {
          const latest = [...store].reverse().find((job) => job.lineId === lineId)
          return latest === undefined ? [] : [latest]
        }),
      ),
    cancelActive: ({ projectId, lineIds }) => {
      const targets = store.filter(
        (job) => job.projectId === projectId && active(job) && (lineIds === undefined || (job.lineId !== null && lineIds.includes(job.lineId))),
      )
      store = store.map((job) => (targets.includes(job) ? { ...job, status: 'cancelled' as const, finishedAt: new Date() } : job))
      return Promise.resolve(store.filter((job) => targets.some((target) => target.id === job.id)))
    },
    markRunning: (id) => replace(id, { status: 'running', startedAt: new Date() }),
    markSucceeded: (id, outcome) =>
      replace(id, {
        status: 'succeeded',
        finishedAt: new Date(),
        costUsd: outcome.costUsd,
        providerRecord: outcome.providerRecord,
        ...(outcome.resultMediaAssetId === undefined ? {} : { resultMediaAssetId: outcome.resultMediaAssetId }),
      }),
    markFailed: (id, error, costUsd) => replace(id, { status: 'failed', finishedAt: new Date(), error, costUsd }),
    sumCostByProject: (projectId) =>
      Promise.resolve(store.filter((job) => job.projectId === projectId).reduce((sum, job) => sum + (job.costUsd ?? 0), 0)),
  }
}

export const createInMemoryAudioSettingsRepository = (): ProjectAudioSettingsRepository => {
  let store: readonly ProjectAudioSettings[] = []
  return {
    get: (projectId) => Promise.resolve(store.find((settings) => settings.projectId === projectId) ?? defaultAudioSettings(projectId)),
    save: (settings) => {
      const valid = ProjectAudioSettings.parse(settings)
      store = [...store.filter((s) => s.projectId !== valid.projectId), valid]
      return Promise.resolve(valid)
    },
  }
}
