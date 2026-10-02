import type { AssistField, ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 入力を AI が手伝う（ADR-0032 の 3 段目）。`POST /projects/{projectId}/assist`。
 * 案を 1 つ返すだけで、欄は書き換えない（使うかは人が決める）。
 */
export type AssistTarget = {
  readonly shotId?: string
  readonly characterId?: string
  readonly lookId?: string
  readonly locationId?: string
}

const WireAssist = z.object({ text: z.string().min(1), costUsd: z.number().nonnegative() })

export type AssistApi = {
  assist: (
    projectId: ProjectId,
    body: {
      readonly field: AssistField
      readonly current: string
      readonly instruction: string | null
    } & AssistTarget,
  ) => Promise<string>
}

export const createAssistApi = (requester: Requester): AssistApi => ({
  assist: async (projectId, body) =>
    (await requester.post(`/projects/${encodeURIComponent(projectId)}/assist`, body, WireAssist)).text,
})
