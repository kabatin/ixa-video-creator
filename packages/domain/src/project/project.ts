import { z } from 'zod'
import { ProjectId, WorkspaceId } from '../common/ids.js'
import { AspectRatio, Fps, Resolution, Seconds } from '../common/time.js'

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
  styleGuide: z.string().default(''),

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
