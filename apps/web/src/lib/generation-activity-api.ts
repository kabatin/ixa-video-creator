import type { ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 動いている生成（順番待ち・作成中）。どのモデルで・いつから・目安は何秒か。
 * 時刻はサーバの記録なので、画面を開き直しても経過が出せる（2026-09-30）。
 */
export const WireActiveGeneration = z.object({
  jobId: z.string(),
  shotId: z.string(),
  status: z.enum(['queued', 'running']),
  modelId: z.string().nullable(),
  modelLabel: z.string().nullable(),
  typicalLatencySec: z.number().nonnegative().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  attempt: z.number().int().positive(),
})
export type WireActiveGeneration = z.infer<typeof WireActiveGeneration>

export type GenerationActivityApi = {
  listActiveGenerations: (projectId: ProjectId) => Promise<readonly WireActiveGeneration[]>
}

export const createGenerationActivityApi = (requester: Requester): GenerationActivityApi => ({
  listActiveGenerations: (projectId) =>
    requester.get(
      `/projects/${encodeURIComponent(projectId)}/generations/active`,
      z.array(WireActiveGeneration),
    ),
})
