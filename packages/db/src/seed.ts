import { eq, isNull } from 'drizzle-orm'
import { WorkspaceId, newId } from '@ixa/domain'
import type { DbClient } from './client.js'
import { workspaces } from './schema/workspace.js'

export type SeededWorkspace = { readonly id: WorkspaceId; readonly name: string }

/**
 * 既定の Workspace を 1 つ用意する。
 * MVP では Workspace は 1 つだけ存在する想定で、作成用の API も UI も持たない。
 * 冪等: 同名の生存行があればそれを返し、新しく作らない。
 */
export const ensureDefaultWorkspace = async (
  db: DbClient,
  name = 'Default Workspace',
): Promise<SeededWorkspace> => {
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.name, name))
    .limit(1)

  const found = existing.find((row) => row.deletedAt === null)
  if (found) return { id: WorkspaceId.parse(found.id), name: found.name }

  const now = new Date()
  const id = newId(WorkspaceId)
  await db.insert(workspaces).values({ id, name, createdAt: now, updatedAt: now })
  return { id, name }
}

/** 生存している Workspace を全件返す。 */
export const listWorkspaces = async (db: DbClient): Promise<SeededWorkspace[]> => {
  const rows = await db.select().from(workspaces).where(isNull(workspaces.deletedAt))
  return rows.map((row) => ({ id: WorkspaceId.parse(row.id), name: row.name }))
}
