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
import { ObjectNotFoundError, mediaKey, type ObjectStorage } from '@ixa/storage'
import type { Logger } from '../logger.js'
import { registerMediaAsset, type MediaIngestDeps } from '../media-intake.js'
import { isUniqueViolation } from '../routes/unique-violation.js'
import { fileExtension, isContentTypeAllowed } from '../routes/uploads.js'
import { sha256Hex, type DemoBundleSource } from './bundle-source.js'
import { DemoFileError, DemoManifestError } from './errors.js'

/**
 * 見本の素材を置き場に入れ、ほかのファイル（波形）を取って確かめる（ADR-0067）。
 *
 * 1. **同じ中身（sha256）の素材が既にあれば、置き場の中身を照らしてから使い、取りに行かない**（2 度目・別の作業場所でも速い）
 * 2. 足りないものを**全部取って確かめてから**置き場に入れる（取れない・壊れていたら、素材は 1 つも入れない）
 * 3. 素材はアップロードの完了と同じ道（`registerMediaAsset`）で登録し、取り込みジョブ（サムネイルなど）を投げる
 *
 * 素材を入れ始めた後で失敗したとき（2 つ目以降で中身の食い違いが分かった・行を作れなかったなど）、**それより前に登録した
 * 素材は残る**（正しい中身の、重ならない素材で、入れ直すときに使い回す）。見本の作品は作らない。
 * ほかのファイル（波形）はここでは置かない。入れた作品・曲の ID から決まる置き場に、書くときに置く（`waveforms.ts`）。
 */

/** 見本の素材の出自（アップロードと同じ扱い。誰が入れたかの名札）。 */
export const DEMO_UPLOADER = 'demo'

export type DemoMediaDeps = {
  readonly bundle: DemoBundleSource
  readonly mediaAssets: Pick<MediaAssetRepository, 'findByChecksum' | 'findById' | 'create'>
  readonly mediaIngest?: MediaIngestDeps
  readonly storage: Pick<ObjectStorage, 'put' | 'get' | 'exists' | 'delete'>
  readonly logger: Logger
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
    // 行を作れなかった（理由を問わず）。置いたファイルは使われないので消す。消すのも落ちたら、元の失敗を投げる（消せなかったことはログへ）。
    await deps.storage.delete(storageKey).catch((cleanupError: unknown) => {
      deps.logger.error({ err: cleanupError, cause: error, file: pending.entry.file }, '見本の素材の行を作れず、置いたファイルも消せませんでした')
    })
    // 同じ中身の登録が重なった（一意索引が守った）。先にできた方を、中身を照らしてから使う。
    if (!isUniqueViolation(error)) throw error
    const existing = await deps.mediaAssets.findByChecksum(pending.entry.sha256)
    if (existing === null) throw error
    return verifiedReuse(deps, existing, pending.entry)
  }
  if (registered.created) return registered.asset.id
  // 取りに行っている間に、同じ中身が別の道で登録されていた。入れた方は使わないので消し、先の方を照らして使う。
  await deps.storage.delete(storageKey).catch((cleanupError: unknown) => {
    deps.logger.error({ err: cleanupError, file: pending.entry.file }, '使わない見本の素材のファイルを消せませんでした')
  })
  return verifiedReuse(deps, registered.asset, pending.entry)
}

/** 取って確かめたほかのファイル（目録の置き場 → 目録のファイル名と中身）。置くのは書くとき。 */
export type FetchedFiles = ReadonlyMap<string, { readonly file: string; readonly bytes: Uint8Array }>

/**
 * 素材を揃え、ほかのファイルを取って確かめる。目録の素材の ID → この機械の素材の ID の表と、取ったファイルを返す。
 */
export const installDemoMedia = async (
  deps: DemoMediaDeps,
  manifest: DemoManifest,
  workspaceId: WorkspaceId,
): Promise<{ readonly ids: ReadonlyMap<string, MediaAssetId>; readonly files: FetchedFiles }> => {
  const ids = new Map<string, MediaAssetId>()
  const missingMedia: { readonly entry: DemoMediaEntry; readonly ext: string }[] = []
  for (const entry of manifest.media) {
    const ext = extensionOf(entry)
    const existing = await deps.mediaAssets.findByChecksum(entry.sha256)
    if (existing === null) missingMedia.push({ entry, ext })
    else ids.set(entry.id, await verifiedReuse(deps, existing, entry))
  }

  // 全部取って確かめてから入れる（1 つずつ。見本のファイルは数 MB で、同時に取る必要は無い）。
  const media: PendingMedia[] = []
  for (const { entry, ext } of missingMedia) media.push({ entry, ext, bytes: await deps.bundle.fetchFile(manifest, entry) })
  const files = new Map<string, { readonly file: string; readonly bytes: Uint8Array }>()
  for (const entry of manifest.files) files.set(entry.key, { file: entry.file, bytes: await deps.bundle.fetchFile(manifest, entry) })

  for (const pending of media) ids.set(pending.entry.id, await storeMedia(deps, workspaceId, pending))
  return { ids, files }
}
