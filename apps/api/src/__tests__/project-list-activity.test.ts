import { Project, ProjectId, WorkspaceId, newId, type ProjectActivity } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { ProjectListItemResponse, type ProjectResponse } from '../routes/projects.js'
import { createMemoryStorage } from '@ixa/storage'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 作品一覧の行に進み具合（`activity`）を添える。一覧だけで、1 件・作成・直しの応答は変えない。
 * 数え方そのものは DB の結合テスト（`project-activity.integration.test.ts`）が見る。
 */

const workspaceId = newId(WorkspaceId)

const aProject = (name: string): Project =>
  Project.parse({
    id: newId(ProjectId),
    workspaceId,
    name,
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    durationSec: null,
    budgetUsd: null,
    status: 'planning',
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-02T00:00:00.000Z'),
  })

const build = (projects: readonly Project[], activity: ReadonlyMap<ProjectId, ProjectActivity>) =>
  createTestApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository(projects, { activityOf: (project) => activity.get(project.id) }),
    mediaAssets: createInMemoryMediaAssetRepository(),
    storage: createMemoryStorage(),
    logger: createLogger('silent'),
  })

type ListBody = { success: true; data: ProjectListItemResponse[]; meta: { total: number } }
type OneBody = { success: true; data: ProjectResponse }

describe('GET /projects の進み具合', () => {
  it('行ごとに作品の欄と activity（日時は ISO の文字列）を返す', async () => {
    const night = aProject('NIGHT RUN')
    const empty = aProject('まだ何もない')
    const app = build(
      [night, empty],
      new Map([
        [night.id, { lastActivityAt: new Date('2026-11-10T05:02:00.000Z'), shotCount: 27, adoptedTakeCount: 20, hasRender: true }],
      ]),
    )

    const res = await app.request(`/projects?workspaceId=${workspaceId}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as ListBody
    expect(json.meta.total).toBe(2)
    const byName = new Map(json.data.map((row) => [row.name, row]))
    expect(byName.get('NIGHT RUN')).toMatchObject({
      id: night.id,
      kind: 'mv',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      activity: { lastActivityAt: '2026-11-10T05:02:00.000Z', shotCount: 27, adoptedTakeCount: 20, hasRender: true },
    })
    // 何も無い作品は 0 件で、最終更新は作品を直した時刻。
    expect(byName.get('まだ何もない')?.activity).toEqual({
      lastActivityAt: '2026-11-02T00:00:00.000Z',
      shotCount: 0,
      adoptedTakeCount: 0,
      hasRender: false,
    })
    // 応答の形は公開の型どおり。
    for (const row of json.data) expect(ProjectListItemResponse.safeParse(row).success).toBe(true)
  })

  it('1 件の取得には activity を付けない', async () => {
    const night = aProject('NIGHT RUN')
    const app = build([night], new Map())

    const res = await app.request(`/projects/${night.id}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as OneBody
    expect(json.data).not.toHaveProperty('activity')
  })
})
