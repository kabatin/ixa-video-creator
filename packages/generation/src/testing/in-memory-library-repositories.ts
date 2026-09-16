import { DbNotFoundError, type BrandAssetRepository, type LocationRepository } from '@ixa/db'
import {
  BrandAsset as BrandAssetSchema,
  BrandAssetId as BrandAssetIdSchema,
  CreateBrandAssetInput as CreateBrandAssetInputSchema,
  CreateLocationInput as CreateLocationInputSchema,
  Location as LocationSchema,
  LocationId as LocationIdSchema,
  UpdateBrandAssetPatch as UpdateBrandAssetPatchSchema,
  UpdateLocationPatch as UpdateLocationPatchSchema,
  newId,
  type BrandAsset,
  type BrandAssetId,
  type Location,
  type LocationId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ Asset Library リポジトリ（DOMAIN.md §6）。実 DB には接続しない。
 * softDelete は「生存行のみ返す」実装に合わせ、ストアから取り除くだけにする。
 */

export type InMemoryBrandAssetRepository = BrandAssetRepository & {
  readonly snapshot: () => readonly BrandAsset[]
}

export const createInMemoryBrandAssetRepository = (): InMemoryBrandAssetRepository => {
  let store: readonly BrandAsset[] = []
  const find = (id: BrandAssetId): BrandAsset | undefined => store.find((a) => a.id === id)

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((a) => a.workspaceId === workspaceId)),

    create: (input) => {
      const created = BrandAssetSchema.parse({
        ...CreateBrandAssetInputSchema.parse(input),
        id: newId(BrandAssetIdSchema),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('BrandAsset', id))
      const updated = BrandAssetSchema.parse({
        ...current,
        ...UpdateBrandAssetPatchSchema.parse(patch),
      })
      store = store.map((a) => (a.id === id ? updated : a))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      if (find(id) === undefined) return Promise.reject(new DbNotFoundError('BrandAsset', id))
      store = store.filter((a) => a.id !== id)
      return Promise.resolve()
    },
  }
}

export type InMemoryLocationRepository = LocationRepository & {
  readonly snapshot: () => readonly Location[]
}

export const createInMemoryLocationRepository = (): InMemoryLocationRepository => {
  let store: readonly Location[] = []
  const find = (id: LocationId): Location | undefined => store.find((l) => l.id === id)

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((l) => l.workspaceId === workspaceId)),

    create: (input) => {
      const created = LocationSchema.parse({
        ...CreateLocationInputSchema.parse(input),
        id: newId(LocationIdSchema),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('Location', id))
      const updated = LocationSchema.parse({
        ...current,
        ...UpdateLocationPatchSchema.parse(patch),
      })
      store = store.map((l) => (l.id === id ? updated : l))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      if (find(id) === undefined) return Promise.reject(new DbNotFoundError('Location', id))
      store = store.filter((l) => l.id !== id)
      return Promise.resolve()
    },
  }
}
