import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateProjectInput, Project, ProjectDemoKey, ProjectId, UpdateProjectPatch, WorkspaceId,
} from '@ixa/domain'
import {
  CreateProjectInput as CreateProjectInputSchema,
  ProjectDemoKey as ProjectDemoKeySchema,
  UpdateProjectPatch as UpdateProjectPatchSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  newId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { projects } from '../schema/workspace.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ProjectRow = typeof projects.$inferSelect

/**
 * 作るときの、作成の入力（`CreateProjectInput`）に入れない指定。**同梱の見本を入れる処理だけが渡す。**
 * HTTP の作成口（`POST /projects`）は渡さない（任意の作品を見本にさせない）。
 */
export type CreateProjectOptions = {
  /** 同梱の見本の印（例 `ixa-demo-v1`）。省略は null（ふつうの作品）。 */
  readonly demoKey?: ProjectDemoKey
}

export type ProjectRepository = {
  findById(id: ProjectId): Promise<Project | null>
  findByWorkspace(workspaceId: WorkspaceId): Promise<Project[]>
  /** 見本の印の付いた、消していない作品。無ければ null。複数あれば先に作った方。 */
  findByDemoKey(workspaceId: WorkspaceId, demoKey: ProjectDemoKey): Promise<Project | null>
  create(input: CreateProjectInput, options?: CreateProjectOptions): Promise<Project>
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
    kind: row.kind,
    demoKey: row.demoKey,
    fps: row.fps,
    resolution: row.resolution,
    aspectRatio: row.aspectRatio,
    durationSec: row.durationSec,
    budgetUsd: row.budgetUsd,
    styleGuide: row.styleGuide,
    avoid: row.avoid,
    styleReferenceAssetIds: row.styleReferenceAssetIds,
    lyrics: row.lyrics,
    lyricCues: row.lyricCues,
    instrumental: row.instrumental,
    masteringMode: row.masteringMode,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const liveById = (id: ProjectId) => and(eq(projects.id, id), isNull(projects.deletedAt))

export const createProjectRepository = (db: DbExecutor): ProjectRepository => ({
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

  async findByDemoKey(workspaceId, demoKey) {
    const key = ProjectDemoKeySchema.parse(demoKey)
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.demoKey, key), isNull(projects.deletedAt)))
      .orderBy(asc(projects.id))
      .limit(1)
    const row = rows[0]
    return row ? projectRowToDomain(row) : null
  },

  async create(input, options = {}) {
    const validated = CreateProjectInputSchema.parse(input)
    const demoKey = options.demoKey === undefined ? null : ProjectDemoKeySchema.parse(options.demoKey)
    const now = new Date()
    const rows = await db
      .insert(projects)
      .values({
        id: newId(ProjectIdSchema),
        workspaceId: validated.workspaceId,
        name: validated.name,
        kind: validated.kind,
        demoKey,
        fps: validated.fps,
        resolution: validated.resolution,
        aspectRatio: validated.aspectRatio,
        durationSec: null,
        budgetUsd: validated.budgetUsd,
        styleGuide: validated.styleGuide,
        avoid: '',
        styleReferenceAssetIds: [],
        lyrics: '',
        lyricCues: [],
        instrumental: false,
        masteringMode: null,
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
