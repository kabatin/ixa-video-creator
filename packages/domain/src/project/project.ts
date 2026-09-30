import { z } from 'zod'
import { MediaAssetId, ProjectId, WorkspaceId } from '../common/ids.js'
import { AspectRatio, Fps, Resolution, Seconds } from '../common/time.js'

/** 手本画像（ムードボード）の上限（ADR-0030）。参照の上限（Codex は 4 枚）に人物や場所の分を残す。 */
export const MAX_STYLE_REFERENCES = 3

export const ProjectStatus = z.enum([
  'planning', 'production', 'review', 'finalizing', 'done',
])
export type ProjectStatus = z.infer<typeof ProjectStatus>

export const Project = z.object({
  id: ProjectId,
  workspaceId: WorkspaceId,
  name: z.string().min(1).max(200),

  // 出力仕様。レンダリングと Provider 選択の制約になる。
  fps: Fps,
  resolution: Resolution,
  aspectRatio: AspectRatio,

  // 制作制約
  durationSec: Seconds.nullable(),
  budgetUsd: z.number().nonnegative().nullable(),

  /**
   * 作品の方針（ADR-0030）。コンセプト（あらすじ・世界観）は脚本（Script）に持つ。
   *
   * - `styleGuide`（ルック）: 画風・光・質感。全 Shot の映像と Shot の絵の生成指示に入る
   * - `avoid`（避けたいもの）: 指示文に「避けること」として入れられる所（Shot の絵・AI の下書き）にだけ入る。
   *   否定の指定に対応する映像モデルが今は無いので、映像には入らない
   * - `styleReferenceAssetIds`（手本画像）: 全 Shot の生成に見た目の手本（参照の役割 `style`）として添える
   */
  styleGuide: z.string().default(''),
  avoid: z.string().default(''),
  styleReferenceAssetIds: z.array(MediaAssetId).max(MAX_STYLE_REFERENCES).default([]),

  status: ProjectStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Project = z.infer<typeof Project>

export const CreateProjectInput = Project.pick({
  workspaceId: true, name: true, fps: true, resolution: true, aspectRatio: true,
}).extend({
  budgetUsd: z.number().nonnegative().nullable().default(null),
  styleGuide: z.string().default(''),
})
export type CreateProjectInput = z.input<typeof CreateProjectInput>

/**
 * 更新可能な列。リポジトリの契約はドメインが定義する（ADR-0007）。
 * id / workspaceId / createdAt は変更できない。
 */
export const UpdateProjectPatch = Project.omit({
  id: true, workspaceId: true, createdAt: true, updatedAt: true,
}).partial()
export type UpdateProjectPatch = z.input<typeof UpdateProjectPatch>
