import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { seg, type ApiClient } from '../api-client.js'
import { WireSignedUpload, WireSignedUrl } from '../wire.js'
import { z } from 'zod'

/**
 * 素材の出し入れ。2 段階アップロード（sign → PUT → complete）と、署名付き URL からの取り出し。
 * **署名付き URL は局所変数の中で使い切る。** 結果にもログにも残さない（規約 7）。
 */

export type MediaKind = 'image' | 'video' | 'audio'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

export const contentTypeFor = (path: string): string | null =>
  CONTENT_TYPES[extname(path).toLowerCase()] ?? null

/** この MCP から上げた素材の投稿者名（画面の「誰が上げたか」で見分ける）。 */
export const MCP_UPLOADER = 'mcp'

const WireUploaded = z.object({ id: z.string() })

export type UploadParams = {
  readonly workspaceId: string
  readonly projectId: string
  readonly kind: MediaKind
}

/** 手元のファイルを ixa の素材にする。返すのは MediaAsset の ID。 */
export const uploadLocalFile = async (
  api: ApiClient,
  filePath: string,
  params: UploadParams,
): Promise<string> => {
  const contentType = contentTypeFor(filePath)
  if (contentType === null) {
    throw new Error(`拡張子から種類が分かりません: ${basename(filePath)}（${Object.keys(CONTENT_TYPES).join(' ')}）`)
  }
  if (!contentType.startsWith(`${params.kind}/`)) {
    throw new Error(`${basename(filePath)} は ${params.kind} ではありません（${contentType}）`)
  }
  const bytes = await readFile(filePath).catch((error: unknown) => {
    throw new Error(`ファイルを読めませんでした: ${filePath}`, { cause: error })
  })
  const signed = await api.post(
    '/uploads/sign',
    {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      kind: params.kind,
      fileName: basename(filePath),
      contentType,
      bytes: bytes.length,
    },
    WireSignedUpload,
  )
  await api.upload(signed.uploadUrl, bytes, contentType)
  const done = await api.post(
    '/uploads/complete',
    {
      mediaAssetId: signed.mediaAssetId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      kind: params.kind,
      storageKey: signed.storageKey,
      mimeType: contentType,
      bytes: bytes.length,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      uploadedBy: MCP_UPLOADER,
    },
    WireUploaded,
  )
  return done.id
}

/** MediaAsset の本体を `targetPath` に書き出す。途中で落ちたら半端なファイルを残さない。 */
export const downloadMedia = async (
  api: ApiClient,
  mediaAssetId: string,
  targetPath: string,
): Promise<{ readonly path: string; readonly bytes: number }> => {
  const signed = await api.get(`/media/${seg(mediaAssetId)}/url`, WireSignedUrl, { expiresInSec: 600 })
  const response = await api.download(signed.url)
  if (response.body === null) throw new Error('素材の本文が空でした')
  await mkdir(dirname(targetPath), { recursive: true })
  const partial = `${targetPath}.part`
  try {
    await pipeline(
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      createWriteStream(partial),
    )
    await rename(partial, targetPath)
  } catch (error) {
    await rm(partial, { force: true })
    throw new Error(`素材を書き出せませんでした: ${targetPath}`, { cause: error })
  }
  return { path: targetPath, bytes: (await stat(targetPath)).size }
}

/** MIME から保存する拡張子。 */
export const extensionFor = (mimeType: string): string => {
  const found = Object.entries(CONTENT_TYPES).find(([, type]) => type === mimeType)
  return found === undefined ? '.bin' : found[0]
}
