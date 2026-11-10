import type { MediaAssetRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  newId,
  type DemoManifest,
  type DemoMediaEntry,
  type MediaAssetId,
  type WorkspaceId,
} from '@ixa/domain'
import { contentTypeForKey, mediaKey, type ObjectStorage } from '@ixa/storage'
import { registerMediaAsset, type MediaIngestDeps } from '../media-intake.js'
import { isUniqueViolation } from '../routes/unique-violation.js'
import { fileExtension, isContentTypeAllowed } from '../routes/uploads.js'
import type { DemoBundleSource } from './bundle-source.js'
import { DemoManifestError } from './errors.js'

/**
 * 見本の素材とファイルを置き場に入れる（ADR-0067）。
 *
 * 1. **同じ中身（sha256）の素材が既にあれば、それを使って取りに行かない**（2 度目・別の作業場所でも速い）
 * 2. 足りないものを**全部取って確かめてから**置き場に入れる（1 つでも合わなければ何も入れない）
 * 3. 素材はアップロードの完了と同じ道（`registerMediaAsset`）で登録し、取り込みジョブ（サムネイルなど）を投げる
 */

/** 見本の素材の出自（アップロードと同じ扱い。誰が入れたかの名札）。 */
export const DEMO_UPLOADER = 'demo'

export type DemoMediaDeps = {
  readonly bundle: DemoBundleSource
  readonly mediaAssets: Pick<MediaAssetRepository, 'findByChecksum' | 'create'>
  readonly mediaIngest?: MediaIngestDeps
  readonly storage: Pick<ObjectStorage, 'put' | 'exists' | 'delete'>
}

type PendingMedia = { readonly entry: DemoMediaEntry; readonly ext: string; readonly bytes: Uint8Array }

/** 素材の拡張子と種類を確かめる（取りに行く前に）。 */
const extensionOf = (entry: DemoMediaEntry): string => {
  const ext = fileExtension(entry.file)
  if (ext === null || !isContentTypeAllowed(entry.kind, entry.contentType)) {
    throw new DemoManifestError(`見本の目録の素材 ${entry.file} の種類が合いません`)
  }
  return ext
}

/** 取って確かめた素材を置き場に入れ、登録する。同じ中身が先に登録されていたら、そちらを使う。 */
const storeMedia = async (deps: DemoMediaDeps, workspaceId: WorkspaceId, pending: PendingMedia): Promise<MediaAssetId> => {
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(workspaceId, id, pending.ext)
  await deps.storage.put(storageKey, pending.bytes, { contentType: pending.entry.contentType })
  const input = {
    id,
    workspaceId,
    projectId: null,
    kind: pending.entry.kind,
    storageKey,
    mimeType: pending.entry.contentType,
    bytes: pending.bytes.byteLength,
    checksumSha256: pending.entry.sha256,
    probe: pending.entry.probe,
    origin: { type: 'upload' as const, uploadedBy: DEMO_UPLOADER },
    tags: [],
  }
  try {
    const registered = await registerMediaAsset(
      { mediaAssets: deps.mediaAssets, ...(deps.mediaIngest === undefined ? {} : { mediaIngest: deps.mediaIngest }) },
      input,
    )
    // 取りに行っている間に、同じ中身が別の道で登録されていた。入れた方は使わないので消す。
    if (!registered.created) await deps.storage.delete(storageKey)
    return registered.asset.id
  } catch (error) {
    // 同じ中身の登録が重なった（一意索引が守った）。先にできた方を使う。
    if (!isUniqueViolation(error)) throw error
    const existing = await deps.mediaAssets.findByChecksum(pending.entry.sha256)
    if (existing === null) throw error
    await deps.storage.delete(storageKey)
    return existing.id
  }
}

/**
 * 素材とファイルを揃え、目録の素材の ID → この機械の素材の ID の表を返す。
 * 取りに行ったファイルの数も返す（2 度目に何も取りに行かないことを確かめるため）。
 */
export const installDemoMedia = async (
  deps: DemoMediaDeps,
  manifest: DemoManifest,
  workspaceId: WorkspaceId,
): Promise<{ readonly ids: ReadonlyMap<string, MediaAssetId>; readonly fetched: number }> => {
  const ids = new Map<string, MediaAssetId>()
  const missingMedia: { readonly entry: DemoMediaEntry; readonly ext: string }[] = []
  for (const entry of manifest.media) {
    const ext = extensionOf(entry)
    const existing = await deps.mediaAssets.findByChecksum(entry.sha256)
    if (existing === null) missingMedia.push({ entry, ext })
    else ids.set(entry.id, existing.id)
  }
  const missingFiles = []
  for (const entry of manifest.files) {
    if (!(await deps.storage.exists(entry.key))) missingFiles.push(entry)
  }

  // 全部取って確かめてから入れる（1 つずつ。見本のファイルは数 MB で、同時に取る必要は無い）。
  const media: PendingMedia[] = []
  for (const { entry, ext } of missingMedia) media.push({ entry, ext, bytes: await deps.bundle.fetchFile(manifest, entry) })
  const files: { readonly key: string; readonly bytes: Uint8Array }[] = []
  for (const entry of missingFiles) files.push({ key: entry.key, bytes: await deps.bundle.fetchFile(manifest, entry) })

  for (const pending of media) ids.set(pending.entry.id, await storeMedia(deps, workspaceId, pending))
  for (const file of files) await deps.storage.put(file.key, file.bytes, { contentType: contentTypeForKey(file.key) })
  return { ids, fetched: media.length + files.length }
}
