import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DbNotFoundError, type MediaAssetRepository } from '@ixa/db'
import {
  CreateMediaAssetInput as CreateMediaAssetInputSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  UpdateMediaAssetPatch as UpdateMediaAssetPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAsset,
  type MediaAssetId,
  type MediaKind,
  type MediaOrigin,
  type MediaProbe,
} from '@ixa/domain'
import { mediaKey, type ObjectStorage } from '@ixa/storage'
import pino from 'pino'

/**
 * media プロセッサのテストダブル。
 * 実 DB / 実ストレージには接続しない（ffmpeg だけは実物を使う）。
 */

export const silentLogger = pino({ level: 'silent' })

export type InMemoryMediaAssets = MediaAssetRepository & {
  readonly snapshot: () => readonly MediaAsset[]
  /** update が呼ばれた回数。部分的な更新が起きていないことの確認に使う。 */
  readonly updateCount: () => number
}

export const inMemoryMediaAssets = (): InMemoryMediaAssets => {
  let store: readonly MediaAsset[] = []
  let updates = 0

  const find = (id: MediaAssetId): MediaAsset | undefined => store.find((a) => a.id === id)

  return {
    snapshot: () => store,
    updateCount: () => updates,

    findById: (id) => Promise.resolve(find(id) ?? null),
    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((a) => a.workspaceId === workspaceId)),
    findByProject: (projectId) => Promise.resolve(store.filter((a) => a.projectId === projectId)),
    findByChecksum: (checksum) =>
      Promise.resolve(store.find((a) => a.checksumSha256 === checksum) ?? null),

    create: (input) => {
      const validated = CreateMediaAssetInputSchema.parse(input)
      const created = MediaAssetSchema.parse({
        ...validated,
        id: validated.id ?? newId(MediaAssetIdSchema),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('MediaAsset', id))
      updates += 1
      const updated = MediaAssetSchema.parse({
        ...current,
        ...UpdateMediaAssetPatchSchema.parse(patch),
      })
      store = store.map((a) => (a.id === id ? updated : a))
      return Promise.resolve(updated)
    },

    softDelete: () => Promise.resolve(),
  }
}

export type SeedAssetInput = {
  readonly kind: MediaKind
  readonly ext: string
  readonly mimeType: string
  readonly body: Uint8Array
  /** ストレージへ実体を置かないことで「原本が取れない」失敗を再現する。 */
  readonly skipUpload?: boolean
  /**
   * 取り込みパイプラインを通さずに probe が入っている状態を作る。
   * render は出力 MediaAsset を作る時点で尺だけの probe を書き込むため、
   * その状態を再現して冪等判定を検証するのに使う。
   */
  readonly probe?: MediaProbe
  /** 既定は upload。render 由来の素材を再現したいときに指定する。 */
  readonly origin?: MediaOrigin
}

/**
 * MediaAsset を 1 件登録し、ストレージにも原本を置く。
 * storageKey は必ず `@ixa/storage` の mediaKey で組み立てる。
 */
export const seedAsset = async (
  repo: MediaAssetRepository,
  storage: ObjectStorage,
  input: SeedAssetInput,
): Promise<MediaAsset> => {
  const workspaceId = newId(WorkspaceIdSchema)
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(workspaceId, id, input.ext)

  if (input.skipUpload !== true) {
    await storage.put(storageKey, input.body, { contentType: input.mimeType })
  }

  return repo.create({
    id,
    workspaceId,
    projectId: null,
    kind: input.kind,
    storageKey,
    mimeType: input.mimeType,
    bytes: input.body.byteLength,
    checksumSha256: createHash('sha256').update(input.body).digest('hex'),
    probe: input.probe ?? null,
    origin: input.origin ?? { type: 'upload', uploadedBy: 'test' },
    tags: [],
  })
}

/** ffmpeg で作った素材をバイト列として読み込む。 */
export const readBytes = async (filePath: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(filePath))
