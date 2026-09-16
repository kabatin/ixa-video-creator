import { DbNotFoundError, type ProjectRepository } from '@ixa/db'
import {
  CreateProjectInput as CreateProjectInputSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  UpdateProjectPatch as UpdateProjectPatchSchema,
  newId,
  type Project,
  type ProjectId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ ProjectRepository。実 DB には接続しない。
 * 実装と同じく Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 */
export type InMemoryProjectRepository = ProjectRepository & {
  /** 現在保持しているプロジェクト（削除済みを除く）。 */
  readonly snapshot: () => readonly Project[]
}

export const createInMemoryProjectRepository = (
  seed: readonly Project[] = [],
): InMemoryProjectRepository => {
  let store: readonly Project[] = seed.map((project) => ProjectSchema.parse(project))

  const find = (id: ProjectId): Project | undefined => store.find((p) => p.id === id)

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((project) => project.workspaceId === workspaceId)),

    create: (input) => {
      const validated = CreateProjectInputSchema.parse(input)
      const now = new Date()
      const created = ProjectSchema.parse({
        id: newId(ProjectIdSchema),
        workspaceId: validated.workspaceId,
        name: validated.name,
        fps: validated.fps,
        resolution: validated.resolution,
        aspectRatio: validated.aspectRatio,
        durationSec: null,
        budgetUsd: validated.budgetUsd,
        styleGuide: validated.styleGuide,
        status: 'planning',
        createdAt: now,
        updatedAt: now,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) {
        return Promise.reject(new DbNotFoundError('Project', id))
      }
      const validated = UpdateProjectPatchSchema.parse(patch)
      const updated = ProjectSchema.parse({ ...current, ...validated, updatedAt: new Date() })
      store = store.map((project) => (project.id === id ? updated : project))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      if (find(id) === undefined) {
        return Promise.reject(new DbNotFoundError('Project', id))
      }
      store = store.filter((project) => project.id !== id)
      return Promise.resolve()
    },
  }
}

/**
 * 常に例外を投げる ProjectRepository。
 * 500 応答に内部エラーの詳細が漏れないことを確かめるために使う。
 */
export const createFailingProjectRepository = (error: Error): ProjectRepository => ({
  findById: () => Promise.reject(error),
  findByWorkspace: () => Promise.reject(error),
  create: () => Promise.reject(error),
  update: () => Promise.reject(error),
  softDelete: () => Promise.reject(error),
})
