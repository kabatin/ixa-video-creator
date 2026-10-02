import type { ProjectId, Shot, ShotId } from '@ixa/domain'
import { z } from 'zod'
import { WireShot } from '@/lib/api-schemas'
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
  /** この 1 本の目安（秒）。尺で伸びるモデルは作る尺から（サーバが出す。画面で計算しない）。 */
  estimatedLatencySec: z.number().nonnegative().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  attempt: z.number().int().positive(),
})
export type WireActiveGeneration = z.infer<typeof WireActiveGeneration>

const WireCancelledGenerations = z.object({
  cancelledJobIds: z.array(z.string()),
  shot: WireShot,
})

export type GenerationActivityApi = {
  listActiveGenerations: (projectId: ProjectId) => Promise<readonly WireActiveGeneration[]>
  /**
   * その Shot で動いている生成をすべてやめる（制作者 2026-10-01）。生成先に届かなくても取り消しは確定する。
   * 決め直した Shot（Take が無ければ下書き）を返す。動いている生成が無ければ空で返る。
   */
  cancelGenerations: (
    shotId: ShotId,
  ) => Promise<{ readonly cancelledJobIds: readonly string[]; readonly shot: Shot }>
}

export const createGenerationActivityApi = (requester: Requester): GenerationActivityApi => ({
  listActiveGenerations: (projectId) =>
    requester.get(
      `/projects/${encodeURIComponent(projectId)}/generations/active`,
      z.array(WireActiveGeneration),
    ),
  cancelGenerations: (shotId) =>
    requester.post(
      `/shots/${encodeURIComponent(shotId)}/generations/cancel`,
      {},
      WireCancelledGenerations,
    ),
})
