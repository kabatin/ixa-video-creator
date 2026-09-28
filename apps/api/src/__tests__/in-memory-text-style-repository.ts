import type { TextStyleRepository } from '@ixa/db'
import { DbNotFoundError } from '@ixa/db'
import {
  CreateTextStylePresetInput,
  TextStyleId,
  TextStylePreset,
  UpdateTextStylePresetPatch,
  newId,
} from '@ixa/domain'

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
