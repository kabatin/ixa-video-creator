import { DbNotFoundError, type ProjectRepository } from '@ixa/db'
import {
  CreateProjectInput as CreateProjectInputSchema,
  Project as ProjectSchema,
  ProjectDemoKey as ProjectDemoKeySchema,
  ProjectId as ProjectIdSchema,
  UpdateProjectPatch as UpdateProjectPatchSchema,
  newId,
  type Project,
  type ProjectActivity,
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

export type InMemoryProjectRepositoryOptions = {
  /**
   * 一覧の進み具合（`findByWorkspaceWithActivity`）。Shot や Take を持たないので、テストが作品ごとに渡す。
   * `undefined` を返した作品は「何も無い」（0 件・書き出し無し・最終更新は作品を直した時刻）。
   */
  readonly activityOf?: (project: Project) => ProjectActivity | undefined
}

/** Shot も Take も書き出しも無い作品の進み具合。 */
const emptyActivity = (project: Project): ProjectActivity => ({
  lastActivityAt: project.updatedAt,
  shotCount: 0,
  adoptedTakeCount: 0,
  hasRender: false,
})

export const createInMemoryProjectRepository = (
  seed: readonly Project[] = [],
  options: InMemoryProjectRepositoryOptions = {},
): InMemoryProjectRepository => {
  let store: readonly Project[] = seed.map((project) => ProjectSchema.parse(project))

  const find = (id: ProjectId): Project | undefined => store.find((p) => p.id === id)

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((project) => project.workspaceId === workspaceId)),

    findByWorkspaceWithActivity: (workspaceId) =>
      Promise.resolve(
        store
          .filter((project) => project.workspaceId === workspaceId)
          .map((project) => ({ project, activity: options.activityOf?.(project) ?? emptyActivity(project) })),
      ),

    findByDemoKey: (workspaceId, demoKey) =>
      Promise.resolve(
        store.find((project) => project.workspaceId === workspaceId && project.demoKey === ProjectDemoKeySchema.parse(demoKey)) ??
          null,
      ),

    create: (input, options = {}) => {
      const validated = CreateProjectInputSchema.parse(input)
      const now = new Date()
      const created = ProjectSchema.parse({
        id: newId(ProjectIdSchema),
        workspaceId: validated.workspaceId,
        name: validated.name,
        kind: validated.kind,
        demoKey: options.demoKey ?? null,
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
  findByWorkspaceWithActivity: () => Promise.reject(error),
  findByDemoKey: () => Promise.reject(error),
  create: () => Promise.reject(error),
  update: () => Promise.reject(error),
  softDelete: () => Promise.reject(error),
})
