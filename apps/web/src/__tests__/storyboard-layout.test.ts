import { ProjectId } from '@ixa/domain'
import type { SerializedDockview } from 'dockview-react'
import { describe, expect, it } from 'vitest'
import {
  clearStoryboardLayout,
  readStoredStoryboardLayout,
  storyboardLayoutKey,
  writeStoryboardLayout,
} from '@/lib/storyboard-layout'

const projectId = ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

describe('storyboard layout persistence', () => {
  it('Project ごとに別のキーを使う', () => {
    const other = ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW')
    expect(storyboardLayoutKey(projectId)).not.toBe(storyboardLayoutKey(other))
  })

  it('保存して読み戻し、リセットできる', () => {
    const storage = memoryStorage()
    const layout = { grid: { width: 100, height: 100 }, panels: {} }
    writeStoryboardLayout(storage, projectId, layout as unknown as SerializedDockview)

    expect(readStoredStoryboardLayout(storage, projectId).state).toBe('ready')
    clearStoryboardLayout(storage, projectId)
    expect(readStoredStoryboardLayout(storage, projectId)).toEqual({ state: 'missing' })
  })

  it('壊れた JSON は例外にせず invalid として返す', () => {
    const storage = memoryStorage()
    storage.setItem(storyboardLayoutKey(projectId), '{not-json')
    expect(readStoredStoryboardLayout(storage, projectId).state).toBe('invalid')
  })

  it('JSONでもDockview形式でなければ invalid として返す', () => {
    const storage = memoryStorage()
    storage.setItem(storyboardLayoutKey(projectId), JSON.stringify({ panels: {} }))
    expect(readStoredStoryboardLayout(storage, projectId).state).toBe('invalid')
  })
})
