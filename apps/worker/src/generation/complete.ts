import type { MediaAssetRepository, TakeRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  TakeId as TakeIdSchema,
  newId,
  type MediaKind,
  type Project,
  type ProviderId,
  type ModelId,
  type Shot,
  type ShotGenerationSpec,
  type Take,
} from '@ixa/domain'
import { mediaKey, type ObjectStorage } from '@ixa/storage'
import { downloadToStorage, type DownloadOptions, type DownloadedObject } from './download.js'

/**
 * Provider の完了応答を Take として確定させる。
 * 期限付き URL は保存せず、その場でダウンロードしてストレージへ移す（ARCHITECTURE.md §11）。
 */

/** contentType が分からない段階で key を決めるため、URL の拡張子から推定する。 */
const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,8}$/

export const extensionFromUrl = (url: string, fallback = 'mp4'): string => {
  try {
    const path = new URL(url).pathname
    const dot = path.lastIndexOf('.')
    if (dot <= 0 || dot === path.length - 1) return fallback
    const ext = path.slice(dot + 1).toLowerCase()
    return EXTENSION_PATTERN.test(ext) ? ext : fallback
  } catch {
    return fallback
  }
}

export const mediaKindFor = (contentType: string): MediaKind =>
  contentType.startsWith('image/') ? 'image' : 'video'

export type RecordTakeInput = {
  readonly shot: Shot
  readonly project: Project
  readonly spec: ShotGenerationSpec
  readonly specHash: string
  readonly providerId: ProviderId
  readonly modelId: ModelId
  readonly outputUrl: string
  readonly seedUsed: number | null
  readonly costUsd: number
  readonly raw: Record<string, unknown>
  readonly generationTimeSec: number
}

export type RecordTakeDeps = {
  readonly takes: TakeRepository
  readonly mediaAssets: MediaAssetRepository
  readonly storage: ObjectStorage
  readonly download?: (options: DownloadOptions) => Promise<DownloadedObject>
  readonly maxBytes?: number
  readonly timeoutMs?: number
}

/**
 * ダウンロード → MediaAsset → Take の順に確定させる。
 *
 * MediaAsset.origin は takeId を必要とし、Take は mediaAssetId を必要とするため、
 * 先に両方の ID を採番して循環を解く。
 */
export const recordTake = async (deps: RecordTakeDeps, input: RecordTakeInput): Promise<Take> => {
  const takeId = newId(TakeIdSchema)
  const mediaAssetId = newId(MediaAssetIdSchema)
  const key = mediaKey(input.project.workspaceId, mediaAssetId, extensionFromUrl(input.outputUrl))

  const downloaded = await (deps.download ?? downloadToStorage)({
    url: input.outputUrl,
    storage: deps.storage,
    key,
    maxBytes: deps.maxBytes,
    timeoutMs: deps.timeoutMs,
  })

  await deps.mediaAssets.create({
    id: mediaAssetId,
    workspaceId: input.project.workspaceId,
    projectId: input.project.id,
    kind: mediaKindFor(downloaded.contentType),
    storageKey: downloaded.storageKey,
    mimeType: downloaded.contentType,
    bytes: downloaded.bytes,
    checksumSha256: downloaded.checksumSha256,
    origin: { type: 'generated', takeId },
    tags: [],
  })

  // spec / providerParams / seed / cost / 所要時間をスナップショットする（ADR-0003）。
  return deps.takes.create(
    {
      shotId: input.shot.id,
      mediaAssetId,
      spec: input.spec,
      specHash: input.specHash,
      providerId: input.providerId,
      modelId: input.modelId,
      providerParams: { kind: 'http', request: input.raw },
      seedUsed: input.seedUsed,
      costUsd: input.costUsd,
      generationTimeSec: input.generationTimeSec,
      parentTakeId: null,
      regenerationReason: null,
    },
    takeId,
  )
}
