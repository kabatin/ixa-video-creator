import { z } from 'zod'
import { ImageGenerationJobId, MediaAssetId, ProjectId, RenderJobId, TakeId, WorkspaceId } from '../common/ids.js'
import { Seconds } from '../common/time.js'

export const MediaKind = z.enum(['image', 'video', 'audio', 'font', 'lut', 'other'])
export type MediaKind = z.infer<typeof MediaKind>

export const MediaProbe = z.object({
  /** コンテナの尺。音声が映像より長ければ音声の尺になる。タイムラインや Take の尺はこれを使う。 */
  durationSec: Seconds.nullable(),
  /**
   * 映像ストリームだけの尺。フレームを切り出す位置の基準にする（durationSec だと映像の外を指しうる）。
   * 取れない素材では null。これを持つ前に保存された probe には無いので省略できる。
   */
  videoDurationSec: Seconds.nullable().optional(),
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
  /** 絵コンテの画像（ADR-0029）。Take ではないので `generated` と分ける。 */
  z.object({ type: z.literal('generated_image'), imageJobId: ImageGenerationJobId }),
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
  /**
   * 最終フレームを切り出した派生 MediaAsset。動画のみ。
   *
   * **なぜキーではなく MediaAssetId なのか**: 前 Shot の最終フレームは、
   * 次の Shot の生成へ参照画像として渡される（連続性の担保、ARCHITECTURE.md §8）。
   * 参照は `ShotGenerationSpec.references` を通るため MediaAssetId でなければならない。
   * posterKeys はレビュー用にストレージキーのまま持つ（参照には使わない）。
   */
  lastFrameAssetId: MediaAssetId.nullable().default(null),

  origin: MediaOrigin,
  tags: z.array(z.string()).default([]),
  createdAt: z.date(),
})
export type MediaAsset = z.infer<typeof MediaAsset>

/**
 * 登録時の入力。
 * 派生物（probe / proxy / thumbnail / posters）は media キューが後から埋めるため、
 * 登録時点では省略できる（既定は null / 空配列）。
 */
export const CreateMediaAssetInput = MediaAsset.omit({
  id: true, createdAt: true,
  probe: true, proxyKey: true, thumbnailKey: true, posterKeys: true, lastFrameAssetId: true,
}).extend({
  /**
   * 2 段階アップロードでは署名時に ID が決まる。
   * storageKey にその ULID が埋まるため、行の id と一致させないと
   * パスと行がずれる。省略時のみリポジトリが採番する。
   */
  id: MediaAssetId.optional(),
  probe: MediaProbe.nullable().default(null),
  proxyKey: z.string().nullable().default(null),
  thumbnailKey: z.string().nullable().default(null),
  posterKeys: z.array(z.string()).default([]),
  /**
   * 最終フレームを切り出した派生 MediaAsset。動画のみ。
   *
   * **なぜキーではなく MediaAssetId なのか**: 前 Shot の最終フレームは、
   * 次の Shot の生成へ参照画像として渡される（連続性の担保、ARCHITECTURE.md §8）。
   * 参照は `ShotGenerationSpec.references` を通るため MediaAssetId でなければならない。
   * posterKeys はレビュー用にストレージキーのまま持つ（参照には使わない）。
   */
  lastFrameAssetId: MediaAssetId.nullable().default(null),
})
export type CreateMediaAssetInput = z.input<typeof CreateMediaAssetInput>

/**
 * 取り込みパイプライン（ffprobe / プロキシ / サムネ / ポスターフレーム）が
 * 後から埋める列だけを更新可能にする。storageKey や checksum は不変。
 */
export const UpdateMediaAssetPatch = MediaAsset.pick({
  probe: true, proxyKey: true, thumbnailKey: true, posterKeys: true,
  lastFrameAssetId: true, tags: true,
}).partial()
export type UpdateMediaAssetPatch = z.input<typeof UpdateMediaAssetPatch>
