import type { ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 動いている超解像（順番待ち・作成中。制作者 2026-10-19）。超解像は Shot の状態を変えないので、生成中とは別に聞く。
 * 時刻と見込みはサーバの記録なので、画面を開き直しても経過が出せる。
 */
export const WireActiveUpscale = z.object({
  jobId: z.string(),
  shotId: z.string(),
  sourceTakeId: z.string(),
  status: z.enum(['queued', 'running']),
  queuedAt: z.string(),
  /** 生成先へ送った時刻。 */
  startedAt: z.string().nullable(),
  /** 生成先が返した見込み（秒）。返さない・送る前は null。 */
  estimateSeconds: z.number().nonnegative().nullable(),
})
export type WireActiveUpscale = z.infer<typeof WireActiveUpscale>

export type UpscaleActivityApi = {
  listActiveUpscales: (projectId: ProjectId) => Promise<readonly WireActiveUpscale[]>
}

export const createUpscaleActivityApi = (requester: Requester): UpscaleActivityApi => ({
  listActiveUpscales: (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/upscales/active`, z.array(WireActiveUpscale)),
})
