import { and, asc, eq, getTableName, isNull, sql, type Column, type SQL } from 'drizzle-orm'
import type { ProjectActivity, WorkspaceId } from '@ixa/domain'
import { ProjectActivity as ProjectActivitySchema } from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { shotEditBatches } from '../schema/edit-batch.js'
import { takes } from '../schema/generation.js'
import { renderJobs } from '../schema/render.js'
import { shots } from '../schema/shot.js'
import { projects } from '../schema/workspace.js'

/** 作品の行と、その進み具合。row → Domain はリポジトリが行う（`projectRowToDomain`）。 */
export type ProjectRowWithActivity = {
  readonly row: typeof projects.$inferSelect
  readonly activity: ProjectActivity
}

/**
 * 表の名前付きの列。**素の `${column}` は使えない。** 表 1 つの select では drizzle が列を表の名前なしで書くので、
 * 副問い合わせの中の `"id"` が外の作品と中の Shot のどちらか決まらず落ちた（column reference "id" is ambiguous）。
 */
const q = (column: Column): SQL =>
  sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`

/** 生きている Shot（消した Shot は数えない。本制作では 68 行のうち 41 行が消した Shot だった）。 */
const liveShotCount = sql<number>`(
  select count(*)::int from ${shots}
  where ${q(shots.projectId)} = ${q(projects.id)} and ${q(shots.deletedAt)} is null
)`.mapWith(Number)

/** そのうち Take を採用している Shot。採用中の Take は消せない（`take-hide.ts`）ので、採用の印だけで数える。 */
const adoptedShotCount = sql<number>`(
  select count(*)::int from ${shots}
  where ${q(shots.projectId)} = ${q(projects.id)} and ${q(shots.deletedAt)} is null and ${q(shots.selectedTakeId)} is not null
)`.mapWith(Number)

/** 書き出しが最後まで終わったことがあるか。 */
const hasSucceededRender = sql<boolean>`exists (
  select 1 from ${renderJobs}
  where ${q(renderJobs.projectId)} = ${q(projects.id)} and ${q(renderJobs.status)} = 'succeeded'
)`.mapWith(Boolean)

/**
 * 最後に触った時刻。作品の欄の直し・編集の記録（作った・取り消した）・Take・書き出しジョブのうち一番新しいもの。
 * Take と書き出しは**消した Shot・失敗した書き出しも入れる**（そのとき作品の作業をしたことに変わりはない）。
 * `greatest` は null を飛ばすので、記録の無い出どころは効かない。作品の `updated_at` は null にならない。
 */
const lastActivityAt = sql<Date>`greatest(
  ${q(projects.updatedAt)},
  (select max(greatest(${q(shotEditBatches.createdAt)}, ${q(shotEditBatches.undoneAt)})) from ${shotEditBatches}
    where ${q(shotEditBatches.projectId)} = ${q(projects.id)}),
  (select max(${q(takes.createdAt)}) from ${takes} inner join ${shots} on ${q(shots.id)} = ${q(takes.shotId)}
    where ${q(shots.projectId)} = ${q(projects.id)}),
  (select max(${q(renderJobs.createdAt)}) from ${renderJobs}
    where ${q(renderJobs.projectId)} = ${q(projects.id)})
)`.mapWith(projects.updatedAt)

/**
 * ワークスペースの消していない作品と、それぞれの進み具合。**作品が何件でも 1 回の問い合わせ**
 * （数はすべて相関副問い合わせ。行ごとに問い合わせ直さない）。並びは `findByWorkspace` と同じ id の昇順。
 */
export const selectProjectRowsWithActivity = async (
  db: DbExecutor,
  workspaceId: WorkspaceId,
): Promise<ProjectRowWithActivity[]> => {
  const rows = await db
    .select({
      project: projects,
      shotCount: liveShotCount,
      adoptedTakeCount: adoptedShotCount,
      hasRender: hasSucceededRender,
      lastActivityAt,
    })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
    .orderBy(asc(projects.id))
  return rows.map((row) => ({
    row: row.project,
    activity: ProjectActivitySchema.parse({
      lastActivityAt: row.lastActivityAt,
      shotCount: row.shotCount,
      adoptedTakeCount: row.adoptedTakeCount,
      hasRender: row.hasRender,
    }),
  }))
}
