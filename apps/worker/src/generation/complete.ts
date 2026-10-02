import { createHash } from 'node:crypto'
import { readFile, stat as stat_ } from 'node:fs/promises'
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
import type { ProviderOutput } from '@ixa/provider-core'
import { mediaKey, type ObjectStorage } from '@ixa/storage'
import {
  DEFAULT_MAX_DOWNLOAD_BYTES,
  downloadToStorage,
  type DownloadOptions,
  type DownloadedObject,
} from './download.js'
import type { TakeLineageFields } from './lineage.js'

/**
 * Provider の完了応答を Take として確定させる。
 * 期限付き URL は保存せず、その場でダウンロードしてストレージへ移す（ARCHITECTURE.md §11）。
 */

/**
 * contentType が分かる前に storageKey を決める必要があるため、拡張子を出所から推定する。
 * リモート URL でもローカルの絶対パスでも同じ結果になるようにしている。
 */
const EXTENSION_PATTERN = /^[A-Za-z0-9]{1,8}$/

export const extensionFromUrl = (source: string, fallback = 'mp4'): string => {
  const path = (() => {
    try {
      return new URL(source).pathname
    } catch {
      return source
    }
  })()
  const dot = path.lastIndexOf('.')
  if (dot <= 0 || dot === path.length - 1) return fallback
  const ext = path.slice(dot + 1).toLowerCase()
  return EXTENSION_PATTERN.test(ext) ? ext : fallback
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
  readonly output: ProviderOutput
  readonly seedUsed: number | null
  readonly costUsd: number
  readonly raw: Record<string, unknown>
  readonly generationTimeSec: number
  /**
   * 何の作り直しなのか（DOMAIN.md §10）。通常の生成は `NO_LINEAGE` を明示して渡す。
   * 省略可能にすると「再生成でない」と「系譜を渡し忘れた」が区別できなくなるため必須にしている。
   * Take は Immutable（ADR-0003）なので、ここで入れ損ねた系譜は後から足せない。
   */
  readonly lineage: TakeLineageFields
}

export type RecordTakeDeps = {
  readonly takes: TakeRepository
  readonly mediaAssets: MediaAssetRepository
  readonly storage: ObjectStorage
  readonly download?: (options: DownloadOptions) => Promise<DownloadedObject>
  readonly maxBytes?: number
  readonly timeoutMs?: number
}

/** ローカルファイルをそのままストレージへ取り込む。サイズ上限は共通で効かせる。 */
const ingestLocalFile = async (
  deps: RecordTakeDeps,
  filePath: string,
  key: string,
): Promise<DownloadedObject> => {
  const stat = await stat_(filePath)
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
  if (stat.size > maxBytes) {
    throw new Error(`生成物が大きすぎます: ${stat.size} バイト（上限 ${maxBytes}）`)
  }

  const body = await readFile(filePath)
  const contentType = filePath.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream'
  await deps.storage.put(key, body, { contentType })

  return {
    storageKey: key,
    bytes: body.byteLength,
    contentType,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
  }
}

/**
 * ダウンロード → MediaAsset → Take の順に確定させる。
 *
 * ID の採番順は DOMAIN.md の通り。MediaAsset.origin は takeId を必要とし、
 * Take は mediaAssetId を必要とするため、先に TakeId を採番して循環を断つ。
 *
 * 再入に耐える。同じ内容を 2 度取り込もうとしたときは checksum で気付き、
 * 既にある MediaAsset を使う。MediaAsset だけ作って Take の前に落ちた
 * 中断があっても、その孤児の takeId で Take を作り直して辻褄を合わせる。
 */
export const recordTake = async (deps: RecordTakeDeps, input: RecordTakeInput): Promise<Take> => {
  const takeId = newId(TakeIdSchema)
  const mediaAssetId = newId(MediaAssetIdSchema)
  const key = mediaKey(
    input.project.workspaceId,
    mediaAssetId,
    extensionFromUrl(input.output.type === 'remote' ? input.output.url : input.output.path),
  )

  /**
   * ローカル Provider の出力は自プロセスが書いたファイルなので HTTP を経由しない。
   * SSRF 検査は「Provider が返した外部由来の URL」を守るためのもので、
   * ここに file: を通すために検査を緩めるのは本末転倒である（型で分けている理由）。
   */
  const downloaded =
    input.output.type === 'local'
      ? await ingestLocalFile(deps, input.output.path, key)
      : await (deps.download ?? downloadToStorage)({
          url: input.output.url,
          storage: deps.storage,
          key,
          maxBytes: deps.maxBytes,
          timeoutMs: deps.timeoutMs,
        })

  // spec / providerParams / seed / cost / 所要時間をスナップショットする（ADR-0003）。
  const takeFields = {
    shotId: input.shot.id,
    spec: input.spec,
    specHash: input.specHash,
    providerId: input.providerId,
    modelId: input.modelId,
    providerParams: { kind: 'http', request: input.raw } as const,
    seedUsed: input.seedUsed,
    costUsd: input.costUsd,
    generationTimeSec: input.generationTimeSec,
    // 再生成なら親と理由が入る。通常の生成では両方 null。
    ...input.lineage,
  }

  // 同じ内容を既に取り込んでいないか。中断した取り込みの再開もここで拾う。
  const duplicate = await deps.mediaAssets.findByChecksum(downloaded.checksumSha256)
  if (duplicate !== null && duplicate.origin.type === 'generated') {
    // 見えなくした Take でも行はある。無いとみなして同じ ID で作り直すと主キーがぶつかる。
    const previous = await deps.takes.findById(duplicate.origin.takeId, { includeHidden: true })
    if (previous !== null) return previous
    return deps.takes.create({
      ...takeFields,
      id: duplicate.origin.takeId,
      mediaAssetId: duplicate.id,
    })
  }

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

  return deps.takes.create({ ...takeFields, id: takeId, mediaAssetId })
}
