import {
  ImageGenerationJobId,
  ImageGenerationJobStatus,
  KEY_ART_MAX_COUNT,
  KeyArtInstruction,
  MediaAssetId,
  ProjectId,
  ThumbnailId,
  ThumbnailSpec,
  ThumbnailStatus,
  type ThumbnailSpecInput,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * YouTube のサムネイルの書き出しと、背景を AI に描かせるキーアートの呼び出し口（ADR-0051）。
 *
 * ```
 * POST /projects/{id}/thumbnails         仕様を渡して書き出しを頼む（202。描くのは worker）
 * GET  /thumbnails/{id}                  1 件の状態
 * GET  /projects/{id}/thumbnails         これまでの書き出し（新しい順）
 * POST /projects/{id}/key-art/generate   キーアートを何枚か頼む（202）
 * GET  /projects/{id}/key-art            キーアートのジョブ（新しい順）
 * ```
 *
 * 仕様は domain の `ThumbnailSpec` を通してから送る（形を書き写さない。L-016）。
 */

export const WireThumbnail = z.object({
  id: ThumbnailId,
  projectId: ProjectId,
  spec: ThumbnailSpec,
  status: ThumbnailStatus,
  outputAssetId: MediaAssetId.nullable(),
  fileName: z.string(),
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
})
export type WireThumbnail = z.infer<typeof WireThumbnail>

export const WireThumbnailList = z.array(WireThumbnail)

export const WireThumbnailStarted = z.object({ thumbnailId: ThumbnailId })

export const WireKeyArtJob = z.object({
  id: ImageGenerationJobId,
  status: ImageGenerationJobStatus,
  instruction: z.string().nullable(),
  mediaAssetId: MediaAssetId.nullable(),
  error: z.string().nullable(),
  queuedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
})
export type WireKeyArtJob = z.infer<typeof WireKeyArtJob>

export const WireKeyArtJobList = z.array(WireKeyArtJob)

export const WireKeyArtStarted = z.object({ jobIds: z.array(ImageGenerationJobId) })

export const GenerateKeyArtBody = z.object({
  count: z.number().int().min(1).max(KEY_ART_MAX_COUNT),
  instruction: KeyArtInstruction,
})
export type GenerateKeyArtInput = z.input<typeof GenerateKeyArtBody>

/** 待っている・作っているジョブ。終わったもの（成功・失敗・止めた）は外す。 */
export const isKeyArtActive = (job: Pick<WireKeyArtJob, 'status'>): boolean =>
  job.status === 'queued' || job.status === 'running'

/** 書き出しが終わったか（成功・失敗）。 */
export const isThumbnailSettled = (thumbnail: Pick<WireThumbnail, 'status'>): boolean =>
  thumbnail.status === 'done' || thumbnail.status === 'failed'

export type ThumbnailApi = {
  /** 書き出しを頼む。完了は待たない（状態は `getThumbnail` で追う）。 */
  readonly startThumbnail: (projectId: ProjectId, spec: ThumbnailSpecInput) => Promise<ThumbnailId>
  readonly getThumbnail: (id: ThumbnailId) => Promise<WireThumbnail>
  readonly listThumbnails: (projectId: ProjectId) => Promise<WireThumbnail[]>
  readonly generateKeyArt: (projectId: ProjectId, input: GenerateKeyArtInput) => Promise<ImageGenerationJobId[]>
  readonly listKeyArt: (projectId: ProjectId) => Promise<WireKeyArtJob[]>
}

const projectPath = (projectId: ProjectId, suffix: string): string =>
  `/projects/${encodeURIComponent(projectId)}${suffix}`

export const createThumbnailApi = (requester: Requester): ThumbnailApi => ({
  startThumbnail: async (projectId, spec) => {
    const body = { spec: ThumbnailSpec.parse(spec) }
    return (await requester.post(projectPath(projectId, '/thumbnails'), body, WireThumbnailStarted)).thumbnailId
  },
  getThumbnail: async (id) => requester.get(`/thumbnails/${encodeURIComponent(id)}`, WireThumbnail),
  listThumbnails: async (projectId) => requester.get(projectPath(projectId, '/thumbnails'), WireThumbnailList),
  generateKeyArt: async (projectId, input) => {
    const parsed = GenerateKeyArtBody.parse(input)
    const body = parsed.instruction === null ? { count: parsed.count } : parsed
    return (await requester.post(projectPath(projectId, '/key-art/generate'), body, WireKeyArtStarted)).jobIds
  },
  listKeyArt: async (projectId) => requester.get(projectPath(projectId, '/key-art'), WireKeyArtJobList),
})
