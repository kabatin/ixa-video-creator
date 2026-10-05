import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { MediaAssetId as MediaAssetIdSchema, newId, type MediaAssetId, type MediaOrigin, type Project, type VoiceJobId } from '@ixa/domain'
import { mediaKey } from '@ixa/storage'
import type { VoiceProcessorDeps } from './deps.js'

/**
 * 整えた声（m4a）を素材にする（ADR-0038）。**同じ中身の素材が既にあれば、それを使う**
 * （同じ中身のファイルを 2 つ作れない作り。お試しの声は同じ長さなら同じ音になる）。
 */
export const ingestVoice = async (
  deps: Pick<VoiceProcessorDeps, 'storage' | 'mediaAssets' | 'mediaQueue'>,
  project: Project,
  path: string,
  origin: MediaOrigin,
): Promise<MediaAssetId> => {
  const body = await readFile(path)
  const checksumSha256 = createHash('sha256').update(body).digest('hex')
  const existing = await deps.mediaAssets.findByChecksum(checksumSha256)
  if (existing !== null) return existing.id
  const id = newId(MediaAssetIdSchema)
  const storageKey = mediaKey(project.workspaceId, id, 'm4a')
  await deps.storage.put(storageKey, body, { contentType: 'audio/mp4' })
  await deps.mediaAssets.create({
    id,
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'audio',
    storageKey,
    mimeType: 'audio/mp4',
    bytes: body.byteLength,
    checksumSha256,
    origin,
  })
  // 長さなどの情報は media キューが埋める（ほかの素材と同じ）。
  await deps.mediaQueue.enqueue(id)
  return id
}

export const generatedVoiceOrigin = (voiceJobId: VoiceJobId): MediaOrigin => ({ type: 'generated_voice', voiceJobId })
