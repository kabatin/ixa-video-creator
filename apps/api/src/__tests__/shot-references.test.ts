import {
  ReferenceRole as ReferenceRoleSchema,
  compileSpec,
  computeSpecHash,
  resolveReferences,
  type CharacterBundle,
  type Project,
  type Shot,
} from '@ixa/domain'
import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { baseAppDeps } from './app-deps.js'
import { aCharacterBundle, aProject, createTestContextSource } from './fixtures.js'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'
import {
  CHEAP_MODEL,
  buildFixture,
  postJson,
  type GenerateData,
  type Ok,
} from './shot-test-support.js'

describe('参照がある場合の生成（Phase 2 への備え）', () => {
  /** 参照を持つコンテキストで組んだ仕様のハッシュ。テストの期待値を本番と同じ手順で作る。 */
  const expectedHash = async (
    project: Project,
    shot: Shot,
    bundle: CharacterBundle,
    maxReferences: number,
  ) =>
    computeSpecHash(
      compileSpec({
        project,
        shot,
        characters: [bundle],
        references: resolveReferences({
          characters: [bundle],
          locations: [],
          manualReferences: [],
          previousShotLastFrameId: null,
          startFrameId: null,
          styleReferenceIds: [],
          maxReferences,
          supportedRoles: [...ReferenceRoleSchema.options],
        }),
        generationDurationSec: 4,
        seed: null,
        negativePrompt: null,
      }),
    )

  it('参照が 1 件以上あれば解決されて仕様に載る', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const bundle = aCharacterBundle()

    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([shot]),
      registry: createProviderRegistry([createTestVideoProvider([CHEAP_MODEL])]),
      generationContext: createTestContextSource({ characters: [bundle] }),
    })

    const res = await postJson(app, `/shots/${shot.id}/generate`, { model: 'test/cheap' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    // 参照 3 枚（canonical frame / 顔正面 / 衣装）が載った仕様になっている
    expect(json.data.specHash).toBe(await expectedHash(project, shot, bundle, 3))

    // 参照が無いときとは別の仕様になる
    const empty = buildFixture()
    const withoutRefs = (await (
      await postJson(empty.app, `/shots/${empty.shot.id}/generate`, { model: 'test/cheap' })
    ).json()) as Ok<GenerateData>
    expect(json.data.specHash).not.toBe(withoutRefs.data.specHash)
  })

  it('参照枠が少ないモデルでは切り詰められ、別の仕様になる', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const bundle = aCharacterBundle()
    const tight = testModel({ id: 'test/tight', capabilities: { referenceImages: { max: 1, roles: [...ReferenceRoleSchema.options] } } })

    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([shot]),
      registry: createProviderRegistry([createTestVideoProvider([tight])]),
      generationContext: createTestContextSource({ characters: [bundle] }),
    })

    const res = await postJson(app, `/shots/${shot.id}/generate`, { model: 'test/tight' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    expect(json.data.specHash).toBe(await expectedHash(project, shot, bundle, 1))
    expect(json.data.specHash).not.toBe(await expectedHash(project, shot, bundle, 3))
  })

  it('AUTO では参照上限を満たせないモデルがルーターで弾かれる', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const bundle = aCharacterBundle()
    const noRefs = testModel({
      id: 'test/no-refs',
      costPerSecondUsd: 0.001,
      capabilities: { referenceImages: { max: 0, roles: [] } },
    })

    const jobs = createInMemoryGenerationJobRepository()
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([shot]),
      generationJobs: jobs,
      registry: createProviderRegistry([createTestVideoProvider([CHEAP_MODEL, noRefs])]),
      generationContext: createTestContextSource({ characters: [bundle] }),
    })

    const res = await postJson(app, `/shots/${shot.id}/generate`, { model: 'AUTO' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    // 最安でも参照を受けられないモデルは選ばれない
    expect(json.data.resolvedModel).toBe('test/cheap')

    const rejected = jobs.snapshot()[0]?.routerDecision?.rejected ?? []
    expect(rejected.find((r) => r.modelId === 'test/no-refs')?.reason).toContain('参照画像が 3 枚')
  })

  it('参照枠が 0 のモデルを名指ししたら参照は落ちるが生成は通る', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    const bundle = aCharacterBundle()
    const noRefs = testModel({
      id: 'test/no-refs',
      capabilities: { referenceImages: { max: 0, roles: [] } },
    })

    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([shot]),
      registry: createProviderRegistry([createTestVideoProvider([noRefs])]),
      generationContext: createTestContextSource({ characters: [bundle] }),
    })

    const res = await postJson(app, `/shots/${shot.id}/generate`, { model: 'test/no-refs' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    // 参照画像は 0 枚だが、プロンプト断片（identityAnchors など）には残る
    expect(json.data.specHash).toBe(await expectedHash(project, shot, bundle, 0))
  })

  it('AUTO でどのモデルも要求を満たせなければ 422', async () => {
    const project = aProject()
    const shot = aShot(project.id)
    // 対応値が 1.5 秒だけ。編集尺 3.75 秒は切り上げ先が無く、0.5 倍速で伸ばしても 3 秒にしかならない（ADR-0011 追記）。
    const tooShort = testModel({
      id: 'test/too-short',
      capabilities: { durations: { mode: 'enum', values: [1.5] } },
    })

    const jobs = createInMemoryGenerationJobRepository()
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([shot]),
      generationJobs: jobs,
      registry: createProviderRegistry([createTestVideoProvider([tooShort])]),
      generationContext: createTestContextSource({ characters: [aCharacterBundle()] }),
    })

    const res = await postJson(app, `/shots/${shot.id}/generate`, { model: 'AUTO' })

    expect(res.status).toBe(422)
    expect(jobs.snapshot()).toHaveLength(0)
  })
})
