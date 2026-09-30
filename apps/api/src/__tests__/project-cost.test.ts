import { ProviderId as ProviderIdSchema, newId, ProjectId as ProjectIdSchema } from '@ixa/domain'
import type { Project, Shot, Take } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { STUB_PROVIDER_IDS } from '@ixa/provider-video'
import { describe, expect, it } from 'vitest'
import { projectRoutes, type CostMeterResponse } from '../routes/projects.js'
import { createApp } from '../app.js'
import { baseAppDeps } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * `GET /projects/{id}/cost`（PHASE 6.3）。
 *
 * 見たいのは「額」ではなく「額と出どころが揃って返るか」。
 * 本制作は Take 50 件すべてがスタブで額 0 なので、件数が欠けると
 * 「まだ何も生成していない」と区別が付かなくなる。
 */

/** specHash は 64 文字固定（Take のスキーマ）。ここでは一致判定に使わないので固定値でよい。 */
const STUB_SPEC_HASH = 's'.repeat(64)
const REAL_SPEC_HASH = 'r'.repeat(64)

type Ok<T> = { success: true; data: T }

/**
 * `shots` は**行に出せる Shot を知るため**だけに引く。額の合計には使わない。
 * 偽の TakeRepository は論理削除に関わらず積んだ Take を返す（本物の `findByProject` と同じ約束）。
 */
const buildRoutes = (options: {
  project: Project | null
  shots?: readonly Shot[]
  takes?: readonly Take[]
  /** 下書きの実行費。**生成だけが金を使うわけではない。** */
  draftRuns?: readonly { costUsd: number }[]
  /** レビューの実行費。 */
  reviewCost?: { runCount: number; totalUsd: number }
}) => {
  const project = options.project
  const draftRuns = options.draftRuns ?? []
  return {
    app: projectRoutes({
      projects: createInMemoryProjectRepository(project === null ? [] : [project]),
      mediaAssets: { findById: () => Promise.resolve(null) },
      shots: createInMemoryShotRepository(options.shots ?? []),
      takes: createInMemoryTakeRepository(options.takes ?? []),
      storyboardDrafts: { findRunsByProject: () => Promise.resolve(draftRuns) },
      reviews: {
        sumCostByProject: () =>
          Promise.resolve(options.reviewCost ?? { runCount: 0, totalUsd: 0 }),
      },
      stubProviderIds: [...STUB_PROVIDER_IDS],
    }),
  }
}

const getCost = async (app: ReturnType<typeof projectRoutes>, projectId: string) => {
  const res = await app.request(`/projects/${projectId}/cost`)
  return { status: res.status, body: (await res.json()) as Ok<CostMeterResponse> }
}

const stubTake = (shot: Shot): Take =>
  aTake(shot, STUB_SPEC_HASH, { providerId: ProviderIdSchema.parse('stub'), costUsd: 0 })

const realTake = (shot: Shot, costUsd: number): Take =>
  aTake(shot, REAL_SPEC_HASH, { providerId: ProviderIdSchema.parse('fal'), costUsd })

describe('GET /projects/{id}/cost', () => {
  it('存在しないプロジェクトは 404 を返す', async () => {
    const { app } = buildRoutes({ project: null })
    const res = await app.request(`/projects/${newId(ProjectIdSchema)}/cost`)
    expect(res.status).toBe(404)
  })

  it('ULID でない ID は 422 を返す', async () => {
    const { app } = buildRoutes({ project: aProject() })
    const res = await app.request('/projects/not-a-ulid/cost')
    expect(res.status).toBe(422)
  })

  it('Take が 1 件も無ければ両方のバケツが 0 件で返る', async () => {
    const project = aProject()
    const { app } = buildRoutes({ project })
    const { status, body } = await getCost(app, project.id)

    expect(status).toBe(200)
    expect(body.data.measured).toEqual({ takeCount: 0, totalUsd: 0, byProvider: [] })
    expect(body.data.stub).toEqual({ takeCount: 0, totalUsd: 0 })
    expect(body.data.byShot).toEqual([])
  })

  /** **本制作の状態そのもの。** 額は 0 でも「何回回したか」が残る。 */
  it('スタブだけの Take は件数で返り、実測は 0 件のままになる', async () => {
    const project = aProject({ budgetUsd: 300 })
    const shot = aShot(project.id)
    const { app } = buildRoutes({
      project,
      shots: [shot],
      takes: [stubTake(shot), stubTake(shot)],
    })

    const { body } = await getCost(app, project.id)

    expect(body.data.budgetUsd).toBe(300)
    expect(body.data.stub.takeCount).toBe(2)
    expect(body.data.measured.takeCount).toBe(0)
    expect(body.data.measured.totalUsd).toBe(0)
  })

  it('実 Provider の Take は額と件数が実測側に入る', async () => {
    const project = aProject({ budgetUsd: 300 })
    const shot = aShot(project.id)
    const { app } = buildRoutes({
      project,
      shots: [shot],
      takes: [realTake(shot, 1.5), stubTake(shot)],
    })

    const { body } = await getCost(app, project.id)

    expect(body.data.measured).toEqual({
      takeCount: 1,
      totalUsd: 1.5,
      byProvider: [{ providerId: 'fal', takeCount: 1, totalUsd: 1.5 }],
    })
    expect(body.data.stub.takeCount).toBe(1)
  })

  it('複数 Shot の Take を Shot ごとに分けて返す', async () => {
    const project = aProject({ budgetUsd: 300 })
    const first = aShot(project.id)
    const second = aShot(project.id)
    const { app } = buildRoutes({
      project,
      shots: [first, second],
      takes: [realTake(first, 2), stubTake(second)],
    })

    const { body } = await getCost(app, project.id)

    expect(body.data.byShot).toHaveLength(2)
    expect(body.data.byShot).toContainEqual({
      shotId: first.id,
      measuredUsd: 2,
      stubTakeCount: 0,
    })
    expect(body.data.byShot).toContainEqual({
      shotId: second.id,
      measuredUsd: 0,
      stubTakeCount: 1,
    })
  })

  /**
   * **生きている Shot だけで数えない。** 払った額は Shot を消しても戻らないので、
   * 論理削除済み Shot の Take を落とすと予算の見え方が実際より軽くなる。
   * ここでは `findByShot` が何も返さない偽物を渡し、それでも額が出ることで確かめる。
   */
  it('Shot を辿らず findByProject で数える（論理削除済みの Take も落とさない）', async () => {
    const project = aProject({ budgetUsd: 300 })
    const deleted = aShot(project.id)
    // Shot の一覧は空（= その Shot はもう見えない）。それでも額は落とさない。
    const { app } = buildRoutes({ project, shots: [], takes: [realTake(deleted, 4)] })

    const { body } = await getCost(app, project.id)

    expect(body.data.measured.takeCount).toBe(1)
    expect(body.data.measured.totalUsd).toBe(4)
    expect(body.data.byShot).toEqual([])
    expect(body.data.unlistedShots).toEqual({ takeCount: 1, measuredUsd: 4, stubTakeCount: 0 })
  })

  /** 内訳と合計の差は、黙って消さずに説明を付けて返す（L-015）。 */
  it('消えた Shot の分を内訳から外し、差を unlistedShots で説明する', async () => {
    const project = aProject({ budgetUsd: 300 })
    const live = aShot(project.id)
    const deleted = aShot(project.id)
    const { app } = buildRoutes({
      project,
      shots: [live],
      takes: [realTake(live, 1), realTake(deleted, 2)],
    })

    const { body } = await getCost(app, project.id)

    const listed = body.data.byShot.reduce((sum, row) => sum + row.measuredUsd, 0)
    expect(listed).toBe(1)
    expect(body.data.unlistedShots.measuredUsd).toBe(2)
    expect(listed + body.data.unlistedShots.measuredUsd).toBe(body.data.measured.totalUsd)
  })

  /**
   * **載せ忘れは額では気付けない。** スタブを一覧に入れ忘れると額 0 のまま実測に化ける。
   * 名前が返れば画面で気付ける。
   */
  it('一覧に無い Provider は実測に入り、名前が内訳に出る', async () => {
    const project = aProject({ budgetUsd: 300 })
    const shot = aShot(project.id)
    const forgotten = aTake(shot, REAL_SPEC_HASH, {
      providerId: ProviderIdSchema.parse('stub-v2'),
      costUsd: 0,
    })
    const { app } = buildRoutes({ project, shots: [shot], takes: [forgotten] })

    const { body } = await getCost(app, project.id)

    expect(body.data.measured.takeCount).toBe(1)
    expect(body.data.measured.byProvider).toEqual([
      { providerId: 'stub-v2', takeCount: 1, totalUsd: 0 },
    ])
  })

  it('本物のスタブ ID は内訳に出ない（app と同じ一覧を使う）', async () => {
    const project = aProject({ budgetUsd: 300 })
    const shot = aShot(project.id)
    const { app } = buildRoutes({ project, shots: [shot], takes: [stubTake(shot)] })

    const { body } = await getCost(app, project.id)

    expect(body.data.stub.takeCount).toBe(1)
    expect(body.data.measured.byProvider).toEqual([])
  })

  /** null を 0 に丸めると「予算ゼロ」と区別が付かなくなる（L-021）。 */
  it('予算が未設定なら null をそのまま返す', async () => {
    const project = aProject({ budgetUsd: null })
    const { app } = buildRoutes({ project })

    const { body } = await getCost(app, project.id)
    expect(body.data.budgetUsd).toBeNull()
  })

  /**
   * **配線そのものを 1 件だけ通す。** 他の検査は `projectRoutes` を直接載せているので、
   * `app.ts` が口を繋ぎ忘れても気付けない。ここだけは組み上がったアプリに問い合わせる。
   */
  it('組み上がったアプリからも引ける（app.ts の配線の確認）', async () => {
    const project = aProject({ budgetUsd: 300 })
    const shot = aShot(project.id)
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([shot]),
      takes: createInMemoryTakeRepository([stubTake(shot)]),
    })

    const res = await app.request(`/projects/${project.id}/cost`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as Ok<CostMeterResponse>
    expect(body.data.stub.takeCount).toBe(1)
    expect(body.data.measured.takeCount).toBe(0)
  })
})

/**
 * **生成だけが金を使うわけではない。**
 * 実際に絵コンテ下書きを 1 回回して $0.38 を払ったのに、
 * メーターは $0.00 のままだった（2026-09-18）。予算が実際より軽く見える。
 */
describe('Take 以外で払った額', () => {
  it('下書きとレビューの実行費を合計に入れる', async () => {
    const project = aProject({ budgetUsd: 300 })
    const { app } = buildRoutes({
      project,
      draftRuns: [{ costUsd: 0.38 }, { costUsd: 0.12 }],
      reviewCost: { runCount: 3, totalUsd: 1.5 },
    })

    const { body } = await getCost(app, project.id)

    expect(body.data.totalUsd).toBeCloseTo(0.38 + 0.12 + 1.5, 6)
    const kinds = Object.fromEntries(
      body.data.otherRuns.map((run) => [run.kind, run] as const),
    )
    expect(kinds.storyboard_draft?.kind).toBe('storyboard_draft')
    expect(kinds.storyboard_draft?.runCount).toBe(2)
    expect(kinds.storyboard_draft?.totalUsd).toBeCloseTo(0.5, 6)
    expect(kinds.review?.runCount).toBe(3)
  })

  /** 「レビュー 0 件 $0.00」を並べても読み手には情報が無い。 */
  it('1 度も回していない種類は並べない', async () => {
    const project = aProject({ budgetUsd: 300 })
    const { app } = buildRoutes({ project })

    const { body } = await getCost(app, project.id)

    expect(body.data.otherRuns).toEqual([])
    expect(body.data.totalUsd).toBe(0)
  })
})
