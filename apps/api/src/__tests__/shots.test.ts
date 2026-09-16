import {
  ReferenceRole as ReferenceRoleSchema,
  TakeId as TakeIdSchema,
  compileSpec,
  computeSpecHash,
  newId,
  resolveReferences,
  type CharacterBundle,
  type Project,
  type Shot,
} from '@ixa/domain'
import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from '../app.js'
import { MAX_TAKES_PER_REQUEST, type ShotResponse } from '../routes/shots.js'
import { baseAppDeps, createRecordingQueue, type RecordingQueue } from './app-deps.js'
import { aCharacterBundle, aProject, aShot, aTake, createTestContextSource } from './fixtures.js'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryShotRepository } from './in-memory-shot-repository.js'
import { createInMemoryTakeRepository } from './in-memory-take-repository.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'

type Ok<T> = { success: true; data: T }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }
type GenerateData = {
  jobIds: string[]
  specHash: string
  resolvedModel: string
  duplicateOfTakeId: string | null
}

const CHEAP_MODEL = testModel({ id: 'test/cheap', costPerSecondUsd: 0.01, characterConsistency: 0.1 })
const GOOD_MODEL = testModel({ id: 'test/good', costPerSecondUsd: 0.5, characterConsistency: 0.9 })

type FixtureOptions = {
  project?: Project
  extraShots?: readonly Shot[]
  takes?: readonly ReturnType<typeof aTake>[]
}

/** Shot / Project を積んだアプリ一式。返り値から偽物リポジトリを覗ける。 */
const buildFixture = (options: FixtureOptions = {}) => {
  const project: Project = options.project ?? aProject()
  const shot = aShot(project.id)
  const shots = createInMemoryShotRepository([shot, ...(options.extraShots ?? [])])
  const takes = createInMemoryTakeRepository(options.takes ?? [])
  const generationJobs = createInMemoryGenerationJobRepository()
  const queue: RecordingQueue = createRecordingQueue()

  const deps: AppDeps = {
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots,
    takes,
    generationJobs,
    registry: createProviderRegistry([createTestVideoProvider([CHEAP_MODEL, GOOD_MODEL])]),
    generationQueue: queue,
  }

  return { app: createApp(deps), project, shot, shots, takes, generationJobs, queue }
}

const postJson = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /shots/:id/generate', () => {
  it('仕様を組み立てて GenerationJob を作り、キューへ投入する', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    expect(json.data.jobIds).toHaveLength(1)
    expect(json.data.resolvedModel).toBe('test/cheap')
    expect(json.data.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(json.data.duplicateOfTakeId).toBeNull()

    const jobs = f.generationJobs.snapshot()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('queued')
    expect(jobs[0]?.shotId).toBe(f.shot.id)
    expect(jobs[0]?.specHash).toBe(json.data.specHash)

    // キューに乗るのは ID だけ。実データは worker が DB から読む（ADR-0008）。
    expect(f.queue.enqueued()).toEqual(jobs.map((j) => j.id))

    const shot = f.shots.snapshot()[0]
    expect(shot?.status).toBe('generating')
  })

  it('count の分だけジョブを作る', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      count: MAX_TAKES_PER_REQUEST,
    })

    expect(res.status).toBe(202)
    expect(((await res.json()) as Ok<GenerateData>).data.jobIds).toHaveLength(MAX_TAKES_PER_REQUEST)
    expect(f.queue.enqueued()).toHaveLength(MAX_TAKES_PER_REQUEST)
  })

  it('count が上限を超えたら 422 でジョブを作らない', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      count: MAX_TAKES_PER_REQUEST + 1,
    })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('count')
    expect(f.generationJobs.snapshot()).toHaveLength(0)
    expect(f.queue.enqueued()).toHaveLength(0)
  })

  it('同じ specHash の Take があれば duplicateOfTakeId を返すが、生成は止めない', async () => {
    const f = buildFixture()

    // 1 度目の生成で specHash を得て、その仕様の Take が既にある状態を作る
    const first = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    ).json()) as Ok<GenerateData>
    const duplicate = await f.takes.create({
      ...aTake(f.shot, first.data.specHash),
      specHash: first.data.specHash,
    })

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    expect(json.data.specHash).toBe(first.data.specHash)
    expect(json.data.duplicateOfTakeId).toBe(duplicate.id)
    // 警告であって中断ではない
    expect(json.data.jobIds).toHaveLength(1)
    expect(f.generationJobs.snapshot()).toHaveLength(2)
  })

  it('AUTO ならルーターがモデルを選び、決定を GenerationJob に残す', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'AUTO' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    expect(['test/cheap', 'test/good']).toContain(json.data.resolvedModel)

    const job = f.generationJobs.snapshot()[0]
    expect(job?.requestedModel).toBe('AUTO')
    expect(job?.resolvedModel).toBe(json.data.resolvedModel)
    expect(job?.routerDecision?.modelId).toBe(json.data.resolvedModel)
    expect(job?.routerDecision?.weightsVersion).toBe('balanced-v1')
  })

  it('編集尺をモデルが出せる生成尺へ切り上げた仕様になる（ADR-0011）', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    const json = (await res.json()) as Ok<GenerateData>

    // 編集尺 3.75 秒 → 対応値 4/6/8 のうち 4 秒へ切り上げ
    const expected = await computeSpecHash(
      compileSpec({
        project: f.project,
        shot: f.shot,
        characters: [],
        references: [],
        generationDurationSec: 4,
        seed: null,
        negativePrompt: null,
      }),
    )
    expect(json.data.specHash).toBe(expected)
  })

  it('登録されたモデルで出せない尺なら 422', async () => {
    const project = aProject()
    // 対応値は 4/6/8 秒。30 秒は切り上げ先が無い（ADR-0011）。
    const tooLong = aShot(project.id, { durationSec: 30, code: 'shot_999', order: 9000 })
    const f = buildFixture({ project, extraShots: [tooLong] })

    const res = await postJson(f.app, `/shots/${tooLong.id}/generate`, { model: 'test/cheap' })

    expect(res.status).toBe(422)
    expect(f.generationJobs.snapshot()).toHaveLength(0)
  })

  it('存在しない Shot は 404', async () => {
    const f = buildFixture()
    const res = await postJson(f.app, `/shots/${aShot(f.project.id).id}/generate`, {
      model: 'test/cheap',
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /shots/:id/select-take', () => {
  it('当該 Shot の Take なら selectedTakeId と status を更新する', async () => {
    const f = buildFixture()
    const take = await f.takes.create({
      shotId: f.shot.id,
      mediaAssetId: aTake(f.shot, 'a'.repeat(64)).mediaAssetId,
      spec: aTake(f.shot, 'a'.repeat(64)).spec,
      specHash: 'a'.repeat(64),
      providerId: aTake(f.shot, 'a'.repeat(64)).providerId,
      modelId: aTake(f.shot, 'a'.repeat(64)).modelId,
      providerParams: { kind: 'http', request: {} },
      seedUsed: null,
      costUsd: 0.4,
      generationTimeSec: 10,
      parentTakeId: null,
      regenerationReason: null,
    })

    const res = await postJson(f.app, `/shots/${f.shot.id}/select-take`, { takeId: take.id })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<ShotResponse>
    expect(json.data.selectedTakeId).toBe(take.id)
    expect(json.data.status).toBe('review')
  })

  it('他 Shot の Take を指定したら 422 で Shot を変更しない', async () => {
    const f = buildFixture()
    const otherShot = aShot(f.project.id, { code: 'shot_002', order: 2000 })
    const foreign = aTake(otherShot, 'b'.repeat(64))
    const takes = createInMemoryTakeRepository([foreign])

    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([f.project]),
      shots: f.shots,
      takes,
    })

    const res = await postJson(app, `/shots/${f.shot.id}/select-take`, { takeId: foreign.id })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('takeId')
    expect(f.shots.snapshot()[0]?.selectedTakeId).toBeNull()
  })

  it('存在しない Take を指定したら 422', async () => {
    const f = buildFixture()
    const res = await postJson(f.app, `/shots/${f.shot.id}/select-take`, {
      takeId: newId(TakeIdSchema),
    })
    expect(res.status).toBe(422)
  })
})

describe('Shot CRUD', () => {
  it('一覧は order 昇順', async () => {
    const project = aProject()
    const shots = createInMemoryShotRepository([
      aShot(project.id, { order: 3000, code: 'shot_003' }),
      aShot(project.id, { order: 1000, code: 'shot_001' }),
      aShot(project.id, { order: 2000, code: 'shot_002' }),
    ])
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots,
    })

    const res = await app.request(`/projects/${project.id}/shots`)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { data: ShotResponse[] }
    expect(json.data.map((s) => s.code)).toEqual(['shot_001', 'shot_002', 'shot_003'])
  })

  it('作成は 201、削除は 204 でその後 404 になる', async () => {
    const f = buildFixture()

    const created = await postJson(f.app, `/projects/${f.project.id}/shots`, {
      sequenceId: null,
      order: 1000,
      code: 'shot_010',
      startSec: 0,
      durationSec: 3.75,
      camera: f.shot.camera,
      dialogue: null,
      mood: null,
      sourceType: { type: 'ai_video' },
    })
    expect(created.status).toBe(201)

    const id = ((await created.json()) as Ok<ShotResponse>).data.id
    expect((await f.app.request(`/shots/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await f.app.request(`/shots/${id}/takes`)).status).toBe(404)
  })

  it('PATCH は編集尺とトリム位置を更新できる', async () => {
    const f = buildFixture()

    const res = await f.app.request(`/shots/${f.shot.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationSec: 7.5, sourceInSec: 0.15 }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<ShotResponse>
    expect(json.data.durationSec).toBe(7.5)
    expect(json.data.sourceInSec).toBe(0.15)
    expect(json.data.description).toBe(f.shot.description)
  })
})

describe('GET /shots/:id/takes', () => {
  it('index 昇順で返す', async () => {
    const f = buildFixture()
    const one = aTake(f.shot, 'c'.repeat(64), { index: 1 })
    const two = aTake(f.shot, 'd'.repeat(64), { index: 2 })
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([f.project]),
      shots: f.shots,
      takes: createInMemoryTakeRepository([two, one]),
    })

    const res = await app.request(`/shots/${f.shot.id}/takes`)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { data: { id: string; index: number }[] }
    expect(json.data.map((t) => t.index)).toEqual([1, 2])
  })
})

describe('Take の追記のみ制約（ADR-0003）', () => {
  it('updateReview は reviewStatus / humanVerdict 以外を受け付けない', async () => {
    const f = buildFixture()
    const original = aTake(f.shot, 'e'.repeat(64))
    const takes = createInMemoryTakeRepository([original])

    const updated = await takes.updateReview(original.id, {
      reviewStatus: 'passed',
      humanVerdict: 'approved',
      // 以下は TakeUpdate に無いため strip される
      costUsd: 999,
      specHash: 'f'.repeat(64),
      mediaAssetId: newId(TakeIdSchema),
    } as never)

    expect(updated.reviewStatus).toBe('passed')
    expect(updated.humanVerdict).toBe('approved')
    expect(updated.costUsd).toBe(original.costUsd)
    expect(updated.specHash).toBe(original.specHash)
    expect(updated.mediaAssetId).toBe(original.mediaAssetId)
  })
})

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
    // 対応値が 2 秒だけ。編集尺 3.75 秒は切り上げ先が無い（ADR-0011）。
    const tooShort = testModel({
      id: 'test/too-short',
      capabilities: { durations: { mode: 'enum', values: [2] } },
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

describe('GET /shots/:id', () => {
  it('Shot を 1 件返す', async () => {
    const f = buildFixture()
    const res = await f.app.request(`/shots/${f.shot.id}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<{ id: string; code: string }>
    expect(json.data.id).toBe(f.shot.id)
    expect(json.data.code).toBe(f.shot.code)
  })

  it('存在しない id は 404', async () => {
    const f = buildFixture()
    const res = await f.app.request('/shots/01ARZ3NDEKTSV4RRFFQ69G5FZZ')
    expect(res.status).toBe(404)
  })
})

describe('GET /generation-jobs/:id', () => {
  it('生成ジョブの状態を返す（UI が完了を判定できるようにするため）', async () => {
    const f = buildFixture()
    const gen = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    ).json()) as Ok<GenerateData>
    const jobId = gen.data.jobIds[0] as string

    const res = await f.app.request(`/generation-jobs/${jobId}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<{ id: string; status: string; shotId: string }>
    expect(json.data.id).toBe(jobId)
    expect(json.data.shotId).toBe(f.shot.id)
    expect(json.data.status).toBe('queued')
  })

  it('存在しない id は 404', async () => {
    const f = buildFixture()
    const res = await f.app.request('/generation-jobs/01ARZ3NDEKTSV4RRFFQ69G5FZZ')
    expect(res.status).toBe(404)
  })
})
