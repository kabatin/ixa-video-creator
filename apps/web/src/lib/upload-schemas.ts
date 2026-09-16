import { MediaAsset, MediaAssetId, MediaKind, ProjectId, WorkspaceId } from '@ixa/domain'
import { z } from 'zod'

/**
 * 2 段階アップロード（docs/ARCHITECTURE.md §7）のワイヤ表現。
 * 本体は API を経由せず、署名付き PUT URL で直接ストレージへ送る。
 * 発行された URL は state にも DB にも残さず、都度発行して使い捨てる（CLAUDE.md 規約 7）。
 */

export const SignUploadBody = z.object({
  workspaceId: WorkspaceId,
  projectId: ProjectId.nullable().default(null),
  kind: MediaKind,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  bytes: z.number().int().positive(),
})
export type SignUploadBody = z.input<typeof SignUploadBody>

export const WireSignUploadResult = z.object({
  mediaAssetId: MediaAssetId,
  storageKey: z.string().min(1),
  uploadUrl: z.string().min(1),
  expiresInSec: z.number().int().positive(),
})
export type WireSignUploadResult = z.infer<typeof WireSignUploadResult>

export const CompleteUploadBody = z.object({
  mediaAssetId: MediaAssetId,
  workspaceId: WorkspaceId,
  projectId: ProjectId.nullable().default(null),
  kind: MediaKind,
  storageKey: z.string().min(1),
  mimeType: z.string().min(1).max(255),
  bytes: z.number().int().nonnegative(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/u, 'sha256 は 64 桁の小文字 16 進数です'),
  uploadedBy: z.string().min(1),
})
export type CompleteUploadBody = z.input<typeof CompleteUploadBody>

export const WireMediaAsset = MediaAsset.extend({ createdAt: z.coerce.date() })
export type WireMediaAsset = z.infer<typeof WireMediaAsset>

/** complete の応答。取り込みジョブを投入できたかが `queued` で分かる。 */
export const WireCompleteUploadResult = WireMediaAsset.extend({ queued: z.boolean() })
export type WireCompleteUploadResult = z.infer<typeof WireCompleteUploadResult>
