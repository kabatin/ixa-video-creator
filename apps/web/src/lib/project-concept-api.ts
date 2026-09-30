import type { ProjectId } from '@ixa/domain'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { Requester } from '@/lib/requester'

/**
 * 作品のコンセプト・あらすじ（ADR-0030）。中身は既存の脚本（Script）で、直すたびに版を積む。
 * AI の Shot 説明の下書き（絵コンテの案）がこれを読む。
 */

const WireScriptVersion = z.object({ content: z.string() }).passthrough()
const WireScriptWithCurrentVersion = z.object({ currentVersion: WireScriptVersion.nullable() }).passthrough()
const WireAppendedScriptVersion = z.object({ version: WireScriptVersion }).passthrough()

export type ProjectConceptApi = {
  /** いまのコンセプト。まだ書いていなければ空文字。 */
  getConcept: (projectId: ProjectId) => Promise<string>
  /** 新しい版として保存する（前の版は残る）。 */
  saveConcept: (projectId: ProjectId, content: string) => Promise<void>
}

const path = (projectId: ProjectId): string => `/projects/${encodeURIComponent(projectId)}/script`

export const createProjectConceptApi = (requester: Requester): ProjectConceptApi => ({
  getConcept: async (projectId) => {
    try {
      const found = await requester.get(path(projectId), WireScriptWithCurrentVersion)
      return found.currentVersion?.content ?? ''
    } catch (error) {
      // 脚本がまだ無い作品は 404 が返る（作品そのものはこの画面を開けている時点である）。
      if (error instanceof ApiError && error.status === 404) return ''
      throw error
    }
  },
  saveConcept: async (projectId, content) => {
    await requester.post(`${path(projectId)}/versions`, { content, authoredBy: 'human' }, WireAppendedScriptVersion)
  },
})
