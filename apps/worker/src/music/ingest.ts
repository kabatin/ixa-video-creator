import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { MediaAssetId as MediaAssetIdSchema, newId, type MediaAssetId, type MusicJobId, type Project } from '@ixa/domain'
import { mediaKey } from '@ixa/storage'
import type { MusicProcessorDeps } from './deps.js'

/**
 * できた曲（WAV）を素材にする（ADR-0048）。**同じ中身の素材が既にあれば、それを使う**
 * （同じ中身のファイルを 2 つ作れない作り。投げ直しで同じ曲を 2 度取り込んでも 1 つになる）。
 * 長さなどの情報は media キューが埋める（ほかの素材と同じ）。
 */
export const ingestMusic = async (
  deps: Pick<MusicProcessorDeps, 'storage' | 'mediaAssets' | 'mediaQueue'>,
  project: Project,
  path: string,
  musicJobId: MusicJobId,
): Promise<MediaAssetId> => {
  const body = await readFile(path)
  const checksumSha256 = createHash('sha256').update(body).digest('hex')
  const existing = await deps.mediaAssets.findByChecksum(checksumSha256)
  if (existing !== null) return existing.id
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(project.workspaceId, id, 'wav')
  await deps.storage.put(storageKey, body, { contentType: 'audio/wav' })
  await deps.mediaAssets.create({
    id,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'audio',
    storageKey,
    mimeType: 'audio/wav',
    bytes: body.byteLength,
    checksumSha256,
    origin: { type: 'generated_music', musicJobId },
  })
  await deps.mediaQueue.enqueue(id)
  return id
}
