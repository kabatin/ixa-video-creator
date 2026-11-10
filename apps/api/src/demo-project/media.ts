import type { MediaAssetRepository } from '@ixa/db'
import {
  MediaAssetId as MediaAssetIdSchema,
  newId,
  type DemoManifest,
  type DemoMediaEntry,
  type MediaAsset,
  type MediaAssetId,
  type WorkspaceId,
} from '@ixa/domain'
import { ObjectNotFoundError, contentTypeForKey, mediaKey, type ObjectStorage } from '@ixa/storage'
import { registerMediaAsset, type MediaIngestDeps } from '../media-intake.js'
import { isUniqueViolation } from '../routes/unique-violation.js'
import { fileExtension, isContentTypeAllowed } from '../routes/uploads.js'
import { sha256Hex, type DemoBundleSource } from './bundle-source.js'
import { DemoFileError, DemoManifestError } from './errors.js'

/**
 * 見本の素材とファイルを置き場に入れる（ADR-0067）。
 *
 * 1. **同じ中身（sha256）の素材が既にあれば、置き場の中身を照らしてから使い、取りに行かない**（2 度目・別の作業場所でも速い）
 * 2. 足りないものを**全部取って確かめてから**置き場に入れる（1 つでも合わなければ何も入れない）
 * 3. 素材はアップロードの完了と同じ道（`registerMediaAsset`）で登録し、取り込みジョブ（サムネイルなど）を投げる
 */

/** 見本の素材の出自（アップロードと同じ扱い。誰が入れたかの名札）。 */
export const DEMO_UPLOADER = 'demo'

export type DemoMediaDeps = {
  readonly bundle: DemoBundleSource
  readonly mediaAssets: Pick<MediaAssetRepository, 'findByChecksum' | 'findById' | 'create'>
  readonly mediaIngest?: MediaIngestDeps
  readonly storage: Pick<ObjectStorage, 'put' | 'get' | 'exists' | 'delete'>
}

type PendingMedia = { readonly entry: DemoMediaEntry; readonly ext: string; readonly bytes: Uint8Array }

/** 素材の拡張子と種類を確かめる（取りに行く前に）。 */
export const extensionOf = (entry: DemoMediaEntry): string => {
  const ext = fileExtension(entry.file)
  if (ext === null || !isContentTypeAllowed(entry.kind, entry.contentType)) {
    throw new DemoManifestError(`見本の目録の素材 ${entry.file} の種類が合いません`)
  }
  return ext
}

/**
 * 同じ sha256 の素材を使う前に、置き場の中身を読んで照らす（アップロードの完了はクライアントの申告した checksum を
 * 確かめずに登録する。名札だけを信じると、中身の違う素材を見本の絵として使ってしまう）。違えば使わず、上書きもしない。
 */
const verifiedReuse = async (deps: DemoMediaDeps, asset: MediaAsset, entry: DemoMediaEntry): Promise<MediaAssetId> => {
  let bytes: Uint8Array
  try {
    bytes = await deps.storage.get(asset.storageKey)
  } catch (error) {
    if (error instanceof ObjectNotFoundError) throw new DemoFileError('conflict', entry.file, '同じ名札の素材の中身が置き場にありません', { cause: error })
    throw error
  }
  if (bytes.byteLength !== entry.sizeBytes || sha256Hex(bytes) !== entry.sha256) {
    throw new DemoFileError('conflict', entry.file, '同じ名札の素材の中身が違います')
  }
  return asset.id
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
  let registered: Awaited<ReturnType<typeof registerMediaAsset>>
  try {
    registered = await registerMediaAsset(
      { mediaAssets: deps.mediaAssets, ...(deps.mediaIngest === undefined ? {} : { mediaIngest: deps.mediaIngest }) },
      input,
    )
  } catch (error) {
    // 行を作れなかった（理由を問わず）。置いたファイルは使われないので消す。
    await deps.storage.delete(storageKey)
    // 同じ中身の登録が重なった（一意索引が守った）。先にできた方を、中身を照らしてから使う。
    if (!isUniqueViolation(error)) throw error
    const existing = await deps.mediaAssets.findByChecksum(pending.entry.sha256)
    if (existing === null) throw error
    return verifiedReuse(deps, existing, pending.entry)
  }
  if (registered.created) return registered.asset.id
  // 取りに行っている間に、同じ中身が別の道で登録されていた。入れた方は使わないので消し、先の方を照らして使う。
  await deps.storage.delete(storageKey)
  return verifiedReuse(deps, registered.asset, pending.entry)
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
    else ids.set(entry.id, await verifiedReuse(deps, existing, entry))
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
