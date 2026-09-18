import type { ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { SerializedDockview } from 'dockview-react'

// 初期配置を左右構成へ変えたため、旧配置を新しい既定より優先しない。
const LAYOUT_VERSION = 2

/** 配置は制作データではない。Project ごと・版ごとにブラウザへ閉じる（ADR-0020）。 */
export const storyboardLayoutKey = (projectId: ProjectId): string =>
  `ixa:storyboard-layout:v${String(LAYOUT_VERSION)}:${projectId}`

const SerializedLayout = z.custom<SerializedDockview>(
  (value) => typeof value === 'object' && value !== null && 'grid' in value,
  'Dockview の保存形式ではありません',
)

export type StoredLayoutResult =
  | { readonly state: 'missing' }
  | { readonly state: 'invalid'; readonly reason: string }
  | { readonly state: 'ready'; readonly layout: SerializedDockview }

export const readStoredStoryboardLayout = (
  storage: Pick<Storage, 'getItem'>,
  projectId: ProjectId,
): StoredLayoutResult => {
  const raw = storage.getItem(storyboardLayoutKey(projectId))
  if (raw === null) return { state: 'missing' }

  try {
    const parsed = SerializedLayout.safeParse(JSON.parse(raw) as unknown)
    return parsed.success
      ? { state: 'ready', layout: parsed.data }
      : { state: 'invalid', reason: parsed.error.issues[0]?.message ?? '形式が不正です' }
  } catch (error) {
    return {
      state: 'invalid',
      reason: error instanceof Error ? error.message : 'JSON を読めません',
    }
  }
}

export const writeStoryboardLayout = (
  storage: Pick<Storage, 'setItem'>,
  projectId: ProjectId,
  layout: SerializedDockview,
): void => {
  storage.setItem(storyboardLayoutKey(projectId), JSON.stringify(layout))
}

export const clearStoryboardLayout = (
  storage: Pick<Storage, 'removeItem'>,
  projectId: ProjectId,
): void => {
  storage.removeItem(storyboardLayoutKey(projectId))
}
