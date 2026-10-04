import type { DuplicateProjectRequest, ProjectId } from '@ixa/domain'
import { z } from 'zod'
import { WireProject } from '@/lib/api-schemas'
import type { Requester } from '@/lib/requester'

/**
 * 作品を複製する口（制作者 2026-10-04。ADR-0037）。`POST /projects/{projectId}/duplicate`。
 * 返るのは新しい作品と、外したものの知らせ（画面にそのまま出す文）。
 */
export const WireDuplicatedProject = z.object({
  project: WireProject,
  notes: z.array(z.string()),
})
export type WireDuplicatedProject = z.infer<typeof WireDuplicatedProject>

export type ProjectDuplicateApi = {
  readonly duplicateProject: (projectId: ProjectId, request: DuplicateProjectRequest) => Promise<WireDuplicatedProject>
}

export const createProjectDuplicateApi = (requester: Requester): ProjectDuplicateApi => ({
  duplicateProject: async (projectId, request) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/duplicate`,
      { name: request.name, items: [...request.items] },
      WireDuplicatedProject,
    ),
})
