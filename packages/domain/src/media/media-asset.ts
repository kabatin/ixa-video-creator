import { z } from 'zod'
import { MediaAssetId, ProjectId, RenderJobId, TakeId, WorkspaceId } from '../common/ids.js'
import { Seconds } from '../common/time.js'

export const MediaKind = z.enum(['image', 'video', 'audio', 'font', 'lut', 'other'])
export type MediaKind = z.infer<typeof MediaKind>

export const MediaProbe = z.object({
  durationSec: Seconds.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(),
  hasAudio: z.boolean(),
  codec: z.string().nullable(),
})
export type MediaProbe = z.infer<typeof MediaProbe>

/** ファイルの出自。生成物か、アップロードか、レンダリング結果かを常に追跡できるようにする。 */
export const MediaOrigin = z.discriminatedUnion('type', [
  z.object({ type: z.literal('upload'), uploadedBy: z.string() }),
  z.object({ type: z.literal('generated'), takeId: TakeId }),
  z.object({ type: z.literal('rendered'), renderJobId: RenderJobId }),
  z.object({ type: z.literal('derived'), sourceAssetId: MediaAssetId, operation: z.string() }),
])
export type MediaOrigin = z.infer<typeof MediaOrigin>

/**
 * すべてのファイルの唯一の実体。人物写真も生成動画も最終 MP4 もこれ。
 * 署名付き URL は保存しない（CLAUDE.md 規約 7）。storageKey から都度発行する。
 */
export const MediaAsset = z.object({
  id: MediaAssetId,
  workspaceId: WorkspaceId,
  projectId: ProjectId.nullable(),
  kind: MediaKind,

  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  checksumSha256: z.string().length(64),

  probe: MediaProbe.nullable(),
  proxyKey: z.string().nullable(),
  thumbnailKey: z.string().nullable(),
  posterKeys: z.array(z.string()).default([]),

  origin: MediaOrigin,
  tags: z.array(z.string()).default([]),
  createdAt: z.date(),
})
export type MediaAsset = z.infer<typeof MediaAsset>
