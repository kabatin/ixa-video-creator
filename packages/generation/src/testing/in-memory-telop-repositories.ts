import { DbNotFoundError, type TextStyleRepository, type TimelineClipRepository } from '@ixa/db'
import {
  CreateTextStylePresetInput,
  CreateTimelineClipInput as CreateTimelineClipInputSchema,
  TextStyleId,
  TextStylePreset,
  TimelineClip as TimelineClipSchema,
  TimelineClipId as TimelineClipIdSchema,
  UpdateTextStylePresetPatch,
  UpdateTimelineClipPatch as UpdateTimelineClipPatchSchema,
  newId,
  type TimelineClip,
} from '@ixa/domain'

/**
 * テロップまわり（タイムラインのクリップ・テロップの見た目）のメモリ版。api と、テロップを作り直す処理の検査で使う。
 * 実装と同じく Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 */

export type InMemoryTimelineClipRepository = TimelineClipRepository & {
  readonly snapshot: () => readonly TimelineClip[]
}

export const createInMemoryTimelineClipRepository = (
  seed: readonly TimelineClip[] = [],
): InMemoryTimelineClipRepository => {
  let store: readonly TimelineClip[] = seed.map((clip) => TimelineClipSchema.parse(clip))

  return {
    snapshot: () => store,

    findByProject: (projectId) =>
      Promise.resolve(store.filter((clip) => clip.projectId === projectId)),

    create: (input) => {
      const created = TimelineClipSchema.parse({
        ...CreateTimelineClipInputSchema.parse(input),
        id: newId(TimelineClipIdSchema),
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = store.find((clip) => clip.id === id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('TimelineClip', id))
      const updated = TimelineClipSchema.parse({
        ...current,
        ...UpdateTimelineClipPatchSchema.parse(patch),
      })
      store = store.map((clip) => (clip.id === id ? updated : clip))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      const current = store.find((clip) => clip.id === id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('TimelineClip', id))
      store = store.filter((clip) => clip.id !== id)
      return Promise.resolve(current)
    },

    // 本物と同じく、消す相手が 1 件でも無ければ何も変えずに投げる（まとめて差し替える）。
    replace: (removeIds, inputs) => {
      const missing = removeIds.find((id) => store.find((clip) => clip.id === id) === undefined)
      if (missing !== undefined) return Promise.reject(new DbNotFoundError('TimelineClip', missing))
      const created = inputs.map((input) =>
        TimelineClipSchema.parse({
          ...CreateTimelineClipInputSchema.parse(input),
          id: newId(TimelineClipIdSchema),
          createdAt: new Date(),
        }),
      )
      store = [...store.filter((clip) => !removeIds.includes(clip.id)), ...created]
      return Promise.resolve(created)
    },
  }
}

/** テスト用のメモリ版。論理削除した行は一覧・名前の検索から外れる。 */
export type InMemoryTextStyleRepository = TextStyleRepository & {
  readonly snapshot: () => readonly TextStylePreset[]
}

export const createInMemoryTextStyleRepository = (
  seed: readonly TextStylePreset[] = [],
): InMemoryTextStyleRepository => {
  let store: readonly TextStylePreset[] = seed.map((style) => TextStylePreset.parse(style))
  const find = (id: string) => store.find((style) => style.id === id)

  return {
    snapshot: () => store,
    findByProject: (projectId) => Promise.resolve(store.filter((style) => style.projectId === projectId)),
    findById: (id) => Promise.resolve(find(id) ?? null),
    findByName: (projectId, name) =>
      Promise.resolve(store.find((style) => style.projectId === projectId && style.name === name.trim()) ?? null),
    create: (projectId, input) => {
      const now = new Date()
      const created = TextStylePreset.parse({
        ...CreateTextStylePresetInput.parse(input),
        id: newId(TextStyleId),
        projectId,
        createdAt: now,
        updatedAt: now,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('TextStyle', id))
      const updated = TextStylePreset.parse({ ...current, ...UpdateTextStylePresetPatch.parse(patch), updatedAt: new Date() })
      store = store.map((style) => (style.id === id ? updated : style))
      return Promise.resolve(updated)
    },
    softDelete: (id) => {
      if (find(id) === undefined) return Promise.reject(new DbNotFoundError('TextStyle', id))
      store = store.filter((style) => style.id !== id)
      return Promise.resolve()
    },
  }
}
