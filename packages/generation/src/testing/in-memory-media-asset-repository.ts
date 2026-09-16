import { DbNotFoundError, type MediaAssetRepository } from '@ixa/db'
import {
  CreateMediaAssetInput as CreateMediaAssetInputSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  UpdateMediaAssetPatch as UpdateMediaAssetPatchSchema,
  newId,
  type MediaAsset,
  type MediaAssetId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ MediaAssetRepository。実 DB には接続しない。
 * 実装と同じく Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 * softDelete は「生存行のみ返す」実装に合わせ、ストアから取り除くだけにする。
 */
export type InMemoryMediaAssetRepository = MediaAssetRepository & {
  /** 現在保持している MediaAsset（削除済みを除く）。 */
  readonly snapshot: () => readonly MediaAsset[]
}

export const createInMemoryMediaAssetRepository = (
  seed: readonly MediaAsset[] = [],
): InMemoryMediaAssetRepository => {
  let store: readonly MediaAsset[] = seed.map((asset) => MediaAssetSchema.parse(asset))

  const find = (id: MediaAssetId): MediaAsset | undefined => store.find((a) => a.id === id)

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((asset) => asset.workspaceId === workspaceId)),

    findByProject: (projectId) =>
      Promise.resolve(store.filter((asset) => asset.projectId === projectId)),

    findByChecksum: (checksumSha256) =>
      Promise.resolve(store.find((asset) => asset.checksumSha256 === checksumSha256) ?? null),

    create: (input) => {
      const validated = CreateMediaAssetInputSchema.parse(input)
      const created = MediaAssetSchema.parse({
        ...validated,
        id: newId(MediaAssetIdSchema),
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) {
        return Promise.reject(new DbNotFoundError('MediaAsset', id))
      }
      const validated = UpdateMediaAssetPatchSchema.parse(patch)
      const updated = MediaAssetSchema.parse({ ...current, ...validated })
      store = store.map((asset) => (asset.id === id ? updated : asset))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      if (find(id) === undefined) {
        return Promise.reject(new DbNotFoundError('MediaAsset', id))
      }
      store = store.filter((asset) => asset.id !== id)
      return Promise.resolve()
    },
  }
}

/**
 * 常に例外を投げる MediaAssetRepository。
 * 500 応答に内部エラーの詳細が漏れないことを確かめるために使う。
 */
export const createFailingMediaAssetRepository = (error: Error): MediaAssetRepository => ({
  findById: () => Promise.reject(error),
  findByWorkspace: () => Promise.reject(error),
  findByProject: () => Promise.reject(error),
  findByChecksum: () => Promise.reject(error),
  create: () => Promise.reject(error),
  update: () => Promise.reject(error),
  softDelete: () => Promise.reject(error),
})
