import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateProjectInput, Project, ProjectId, UpdateProjectPatch, WorkspaceId,
} from '@ixa/domain'
import {
  CreateProjectInput as CreateProjectInputSchema,
  UpdateProjectPatch as UpdateProjectPatchSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { projects } from '../schema/workspace.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ProjectRow = typeof projects.$inferSelect

/** 更新可能な列。id / workspaceId / createdAt は変更不可。 */

export type ProjectRepository = {
  findById(id: ProjectId): Promise<Project | null>
  findByWorkspace(workspaceId: WorkspaceId): Promise<Project[]>
  create(input: CreateProjectInput): Promise<Project>
  update(id: ProjectId, patch: UpdateProjectPatch): Promise<Project>
  softDelete(id: ProjectId): Promise<void>
}

/**
 * row → Domain。zod で検証して branded ID を付ける。
 * DB に不正なデータがあれば握り潰さずここで落とす。
 */
export const projectRowToDomain = (row: ProjectRow): Project =>
  ProjectSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    fps: row.fps,
    resolution: row.resolution,
    aspectRatio: row.aspectRatio,
    durationSec: row.durationSec,
    budgetUsd: row.budgetUsd,
    styleGuide: row.styleGuide,
    avoid: row.avoid,
    styleReferenceAssetIds: row.styleReferenceAssetIds,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const liveById = (id: ProjectId) => and(eq(projects.id, id), isNull(projects.deletedAt))

export const createProjectRepository = (db: DbClient): ProjectRepository => ({
  async findById(id) {
    const rows = await db.select().from(projects).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? projectRowToDomain(row) : null
  },

  async findByWorkspace(workspaceId) {
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
      .orderBy(asc(projects.id))
    return rows.map(projectRowToDomain)
  },

  async create(input) {
    const validated = CreateProjectInputSchema.parse(input)
    const now = new Date()
    const rows = await db
      .insert(projects)
      .values({
        id: newId(ProjectIdSchema),
        workspaceId: validated.workspaceId,
        name: validated.name,
        fps: validated.fps,
        resolution: validated.resolution,
        aspectRatio: validated.aspectRatio,
        durationSec: null,
        budgetUsd: validated.budgetUsd,
        styleGuide: validated.styleGuide,
        avoid: '',
        styleReferenceAssetIds: [],
        status: 'planning',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('projects への INSERT が行を返しませんでした')
    return projectRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateProjectPatchSchema.parse(patch)
    const rows = await db
      .update(projects)
      .set({ ...validated, updatedAt: new Date() })
      .where(liveById(id))
      .returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('Project', id)
    return projectRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(liveById(id))
      .returning({ id: projects.id })
    if (rows.length === 0) throw new DbNotFoundError('Project', id)
  },
})
