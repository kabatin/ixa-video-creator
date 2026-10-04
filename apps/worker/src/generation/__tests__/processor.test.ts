import {
  createPhase1EmptyContextSource,
  ProjectEvent,
  type GenerationContextSource,
  type GenerationJob,
  type ShotId,
  type Take,
  TakeId,
  ProviderId as ProviderIdSchema,
} from '@ixa/domain'
import { createProviderRegistry, ProviderError } from '@ixa/provider-core'
import type { ProviderJobStatus } from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it, vi } from 'vitest'
import type { DownloadedObject } from '../download.js'
import {
  MAX_POLL_ATTEMPTS,
  POLL_BACKOFF_BASE_MS,
  POLL_BACKOFF_MAX_MS,
  pollDelayMs,
  processGenerationJob,
  type GenerationProcessorDeps,
} from '../processor.js'
import { rebuildSpec } from '../spec.js'
import {
  aCharacterBundle,
  aProject,
  aShot,
  contextWith,
  createCapturingLogger,
  createFailingEvents,
  createRecordingEvents,
  createRecordingMediaQueue,
  createRecordingScheduler,
  createTestProvider,
  inMemoryJobs,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryShots,
  inMemoryTakes,
  silentLogger,
  testModel,
} from './doubles.js'

const MODEL = testModel()

/** 実ダウンロードはしない。キーだけ受け取って結果を返す。 */
const fakeDownload = vi.fn((options: { key: string }): Promise<DownloadedObject> =>
  Promise.resolve({
    storageKey: options.key,
    bytes: 4096,
    contentType: 'video/mp4',
    checksumSha256: 'a'.repeat(64),
  }),
)

const SUCCEEDED: ProviderJobStatus = {
  state: 'succeeded',
  output: { type: 'remote' as const, url: 'https://cdn.example.com/out.mp4' },
  seedUsed: 4242,
  costUsd: 0.4,
  raw: { id: 'provider-job-1' },
}

const buildFixture = async (
  statuses: readonly ProviderJobStatus[],
  context: GenerationContextSource = createPhase1EmptyContextSource(),
  corrections: readonly string[] = [],
) => {
  const project = aProject()
  const shot = aShot(project)
  const { specHash } = await rebuildSpec(context, shot, project, MODEL, corrections)

  const jobs = inMemoryJobs()
  const job: GenerationJob = await jobs.create({
    shotId: shot.id,
    specHash,
    requestedModel: 'AUTO',
    resolvedModel: MODEL.id,
    corrections: [...corrections],
  })

  const shots = inMemoryShots([shot])
  const takes = inMemoryTakes()
  const mediaAssets = inMemoryMediaAssets()
  const scheduler = createRecordingScheduler()
  const mediaQueue = createRecordingMediaQueue()
  const events = createRecordingEvents()
  const provider = createTestProvider([MODEL], statuses)

  const deps: GenerationProcessorDeps = {
    generationJobs: jobs,
    shots,
    projects: inMemoryProjects([project]),
    takes,
    mediaAssets,
    storage: createMemoryStorage(),
    registry: createProviderRegistry([provider]),
    context,
    scheduler,
    mediaQueue,
    events,
    logger: silentLogger,
    download: fakeDownload,
  }

  return {
    deps,
    job,
    shot,
    project,
    jobs,
    shots,
    takes,
    mediaAssets,
    scheduler,
    mediaQueue,
    specHash,
    provider,
    events,
  }
}

type Fixture = Awaited<ReturnType<typeof buildFixture>>

/**
 * 再生成元になる Take を 1 件だけ用意する。
 * checksum は生成物（'a' の 64 桁）とわざと変える。同じにすると
 * `recordTake` の重複排除が働いて別の経路に入ってしまう。
 */
const seedParentTake = async (f: Fixture, shotId: ShotId = f.shot.id): Promise<Take> => {
  const { spec, specHash } = await rebuildSpec(
    createPhase1EmptyContextSource(),
    f.shot,
    f.project,
    MODEL,
  )
  const asset = await f.mediaAssets.create({
    workspaceId: f.project.workspaceId,
    projectId: f.project.id,
    kind: 'video',
    storageKey: 'media/WS/PARENT/original.mp4',
    mimeType: 'video/mp4',
    bytes: 2048,
    checksumSha256: 'c'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'test' },
    tags: [],
  })
  return f.takes.create({
    shotId,
    mediaAssetId: asset.id,
    spec,
    specHash,
    providerId: MODEL.providerId,
    modelId: MODEL.id,
    providerParams: { kind: 'http', request: {} },
    seedUsed: null,
    costUsd: 0.4,
    generationTimeSec: 12,
    parentTakeId: null,
    regenerationReason: null,
  })
}

/** 投入 → 完了まで 2 回走らせる。 */
const runToCompletion = async (f: Awaited<ReturnType<typeof buildFixture>>) => {
  const first = await processGenerationJob(f.deps, { generationJobId: f.job.id })
  const second = await processGenerationJob(f.deps, { generationJobId: f.job.id })
  return { first, second }
}

describe('processGenerationJob', () => {
  it('未投入なら Provider へ submit し、ポーリングを予約する', async () => {
    const f = await buildFixture([{ state: 'pending', progress: null }])

    const outcome = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(outcome).toEqual({ state: 'submitted', providerJobRef: 'provider-job-1' })
    expect(f.jobs.snapshot()[0]?.status).toBe('running')
    expect(f.jobs.snapshot()[0]?.providerJobRef).toBe('provider-job-1')
    expect(f.scheduler.scheduled()).toEqual([
      { data: { generationJobId: f.job.id }, delayMs: POLL_BACKOFF_BASE_MS },
    ])
  })

  /**
   * **採用が決定**（ADR-0023）。採用済みの Shot で作り直しに成功しても、採用している
   * Take は変わらないので採用済みのまま。以前は成功のたびに `review` へ戻し、
   * 作り直しを 1 本試すだけで「採用待ち」に落ちていた。
   */
  it('採用済みの Shot で作り直しに成功しても、採用済みのまま', async () => {
    const f = await buildFixture([SUCCEEDED])
    await f.deps.shots.selectTake(f.shot.id, TakeId.parse('01HZZZZZZZZZZZZZZZZZZZZZZZ'))

    await runToCompletion(f)

    expect(f.shots.snapshot()[0]?.status).toBe('approved')
  })

  it('成功したら MediaAsset と Take を作り、採用していなければ Shot を採用待ち（review）にする', async () => {
    const f = await buildFixture([SUCCEEDED])

    const { second } = await runToCompletion(f)

    expect(second.state).toBe('succeeded')

    const takes = f.takes.snapshot()
    expect(takes).toHaveLength(1)
    const take = takes[0]
    expect(take?.index).toBe(1)
    expect(take?.shotId).toBe(f.shot.id)
    expect(take?.specHash).toBe(f.specHash)
    expect(take?.seedUsed).toBe(4242)
    expect(take?.costUsd).toBe(0.4)
    expect(take?.generationTimeSec).toBeGreaterThanOrEqual(0)
    expect(take?.spec.durationSec).toBe(4) // 編集尺 3.75 秒 → 4 秒へ切り上げ（ADR-0011）

    const assets = f.mediaAssets.snapshot()
    expect(assets).toHaveLength(1)
    expect(assets[0]?.origin).toEqual({ type: 'generated', takeId: take?.id })
    // 期限付き URL は保存しない
    expect(JSON.stringify(assets[0])).not.toContain('https://cdn.example.com')

    expect(f.shots.snapshot()[0]?.status).toBe('review')
    expect(f.jobs.snapshot()[0]?.status).toBe('succeeded')

    /**
     * 生成物も media キューへ回す。ここを通さないと probe もサムネイルも
     * 最終フレームも作られず、次の Shot の連続性参照が黙って欠ける。
     */
    expect(f.mediaQueue.enqueued()).toEqual([take?.mediaAssetId])
  })

  it('media キューへ入れられなくても Take は確定させる', async () => {
    const f = await buildFixture([SUCCEEDED])
    const failing = {
      ...f.deps,
      mediaQueue: { enqueue: () => Promise.reject(new Error('redis に接続できません')) },
    }

    await processGenerationJob(failing, { generationJobId: f.job.id })
    const second = await processGenerationJob(failing, { generationJobId: f.job.id })

    /**
     * 生成は成功していて課金も済んでいる。キューの不調でそれを捨てない。
     * 失われるのは後から作り直せる派生物（probe / サムネイル / 最終フレーム）だけ。
     */
    expect(second.state).toBe('succeeded')
    expect(f.takes.snapshot()).toHaveLength(1)
    expect(f.jobs.snapshot()[0]?.status).toBe('succeeded')
    expect(f.shots.snapshot()[0]?.status).toBe('review')
  })

  it('同じジョブが 2 回走っても Take を二重に作らない（冪等）', async () => {
    const f = await buildFixture([SUCCEEDED])

    await runToCompletion(f)
    expect(f.takes.snapshot()).toHaveLength(1)

    // 3 回目・4 回目。BullMQ の再試行や重複配信を想定する。
    const again = await processGenerationJob(f.deps, { generationJobId: f.job.id })
    const andAgain = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(again).toEqual({ state: 'skipped', reason: 'status=succeeded' })
    expect(andAgain.state).toBe('skipped')
    expect(f.takes.snapshot()).toHaveLength(1)
    expect(f.mediaAssets.snapshot()).toHaveLength(1)
  })

  it('未完了なら指数バックオフで入れ直す（repeatable job を使わない）', async () => {
    const f = await buildFixture([
      { state: 'running', progress: 0.3 },
      { state: 'running', progress: 0.6 },
    ])

    await processGenerationJob(f.deps, { generationJobId: f.job.id })
    const second = await processGenerationJob(f.deps, { generationJobId: f.job.id })
    const third = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(second).toEqual({ state: 'polling', delayMs: pollDelayMs(2) })
    expect(third).toEqual({ state: 'polling', delayMs: pollDelayMs(3) })
    expect(f.jobs.snapshot()[0]?.attempt).toBe(3)
    expect(f.takes.snapshot()).toHaveLength(0)
  })

  it('Provider が失敗したら error に code / message / retryable を記録する', async () => {
    const f = await buildFixture([
      {
        state: 'failed',
        error: { code: 'content_policy', message: '生成が拒否されました', retryable: false },
      },
    ])

    const { second } = await runToCompletion(f)

    expect(second).toEqual({ state: 'failed', code: 'content_policy' })
    const job = f.jobs.snapshot()[0]
    expect(job?.status).toBe('failed')
    expect(job?.error).toEqual({
      code: 'content_policy',
      message: '生成が拒否されました',
      retryable: false,
    })
    expect(f.takes.snapshot()).toHaveLength(0)
  })

  it('参照を持つコンテキストでも仕様を組み直して Take に残す', async () => {
    const f = await buildFixture([SUCCEEDED], contextWith([aCharacterBundle()]))

    const { second } = await runToCompletion(f)

    expect(second.state).toBe('succeeded')
    const take = f.takes.snapshot()[0]
    // canonical frame / 顔正面 / 衣装 の 3 枚（モデルの上限も 3 枚）
    expect(take?.spec.references).toHaveLength(3)
    expect(take?.spec.references.map((r) => r.role)).toEqual(['subject', 'subject', 'wardrobe'])
    expect(take?.spec.promptParts.identityAnchors).toEqual(['teal twin tails'])
    expect(take?.specHash).toBe(f.specHash)
  })

  it('Shot が変更されて仕様がずれたら投入せずに失敗させる', async () => {
    const f = await buildFixture([SUCCEEDED])
    await f.shots.update(f.shot.id, { description: '差し替えられた演出' })

    const outcome = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(outcome).toEqual({ state: 'failed', code: 'spec_drift' })
    expect(f.jobs.snapshot()[0]?.error?.retryable).toBe(false)
  })

  it('ジョブが存在しなければ例外を投げる', async () => {
    const f = await buildFixture([SUCCEEDED])
    await expect(
      processGenerationJob(f.deps, { generationJobId: '01JBXV0000000000000000000A' }),
    ).rejects.toThrow()
  })

  it('ジョブデータの形が違えば例外を投げる', async () => {
    const f = await buildFixture([SUCCEEDED])
    await expect(processGenerationJob(f.deps, { shotId: 'nope' })).rejects.toThrow()
  })
})

describe('processGenerationJob（Take の系譜）', () => {
  const REASON = 'character_consistency: 顔の造作が参照と違う'

  /**
   * 系譜つきの GenerationJob をもう 1 行作る。
   * **系譜の正は行であってジョブデータではない**ので、ここで積む。
   */
  const seedRegenerationJob = (
    f: Fixture,
    lineage: { parentTakeId?: TakeId; regenerationReason?: string },
  ): Promise<GenerationJob> =>
    f.jobs.create({
      shotId: f.shot.id,
      specHash: f.specHash,
      requestedModel: 'AUTO',
      resolvedModel: MODEL.id,
      ...lineage,
    })

  const run = (f: Fixture, job: GenerationJob) =>
    processGenerationJob(f.deps, { generationJobId: job.id })

  it('通常の生成で作った Take は親も理由も持たない', async () => {
    const f = await buildFixture([SUCCEEDED])

    await runToCompletion(f)

    const take = f.takes.snapshot()[0]
    expect(take?.parentTakeId).toBeNull()
    expect(take?.regenerationReason).toBeNull()
  })

  it('行に積まれた系譜から Take が親と理由を受け継ぐ', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)
    const job = await seedRegenerationJob(f, {
      parentTakeId: parent.id,
      regenerationReason: REASON,
    })

    await run(f, job)
    const second = await run(f, job)

    expect(second.state).toBe('succeeded')
    const created = f.takes.snapshot().find((t) => t.id !== parent.id)
    expect(created?.parentTakeId).toBe(parent.id)
    expect(created?.regenerationReason).toBe(REASON)
  })

  it('ジョブデータは ID だけを運び、入れ直しでも系譜が失われない', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)
    const job = await seedRegenerationJob(f, {
      parentTakeId: parent.id,
      regenerationReason: REASON,
    })

    await run(f, job)
    // ポーリングで入れ直されたデータをそのまま使って続きを回す
    const rescheduled = f.scheduler.scheduled()
    await processGenerationJob(f.deps, rescheduled[0]?.data)

    /**
     * 入れ直すデータに系譜は含まれない。それでも失われないのは、
     * 系譜が generation_jobs の行にあるため。
     */
    expect(rescheduled[0]?.data).toEqual({ generationJobId: job.id })
    const created = f.takes.snapshot().find((t) => t.id !== parent.id)
    expect(created?.parentTakeId).toBe(parent.id)
    expect(created?.regenerationReason).toBe(REASON)
  })

  it('親が実在しなければ投入する前に失敗させる（課金しない）', async () => {
    const f = await buildFixture([SUCCEEDED])
    const job = await seedRegenerationJob(f, {
      parentTakeId: '01JBXV0000000000000000000A' as TakeId,
      regenerationReason: REASON,
    })

    const outcome = await run(f, job)

    expect(outcome).toEqual({ state: 'failed', code: 'parent_take_missing' })
    expect(f.provider.submitted()).toHaveLength(0)
    expect(f.takes.snapshot()).toHaveLength(0)
    expect(f.jobs.snapshot().find((j) => j.id === job.id)?.error?.retryable).toBe(false)
  })

  it('親が別の Shot の Take なら投入する前に失敗させる', async () => {
    const f = await buildFixture([SUCCEEDED])
    const otherShot = aShot(f.project)
    const parent = await seedParentTake(f, otherShot.id)
    const job = await seedRegenerationJob(f, {
      parentTakeId: parent.id,
      regenerationReason: REASON,
    })

    const outcome = await run(f, job)

    expect(outcome).toEqual({ state: 'failed', code: 'parent_take_shot_mismatch' })
    expect(f.provider.submitted()).toHaveLength(0)
  })

  it('完了までに親が消えていたら理由だけ残して Take を確定する', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)
    const job = await seedRegenerationJob(f, {
      parentTakeId: parent.id,
      regenerationReason: REASON,
    })

    await run(f, job)
    // 投入と完了の間に親が消えた状態を作る
    const withoutParent = {
      ...f.deps,
      takes: { ...f.takes, findById: () => Promise.resolve(null) },
    }
    const second = await processGenerationJob(withoutParent, { generationJobId: job.id })

    /**
     * 生成は成功していて課金も済んでいる。親を辿れないことを理由に捨てない。
     * 理由を残すことで「最初の生成」と「親を失った再生成」が区別できる（L-015）。
     */
    expect(second.state).toBe('succeeded')
    const created = f.takes.snapshot().find((t) => t.id !== parent.id)
    expect(created?.parentTakeId).toBeNull()
    expect(created?.regenerationReason).toBe(REASON)
    expect(f.jobs.snapshot().find((j) => j.id === job.id)?.status).toBe('succeeded')
  })

  it('親を消したあとの行（理由だけ）は失敗させず、理由を Take に残す', async () => {
    const f = await buildFixture([SUCCEEDED])
    const job = await seedRegenerationJob(f, { regenerationReason: REASON })

    await run(f, job)
    const second = await run(f, job)

    /**
     * `parent_take_id` は ON DELETE SET NULL なので、親を消すとこの形で残る。
     * 系譜の破損ではないため、投入を止める理由にはならない。
     */
    expect(second.state).toBe('succeeded')
    const created = f.takes.snapshot()[0]
    expect(created?.parentTakeId).toBeNull()
    expect(created?.regenerationReason).toBe(REASON)
  })
})

describe('processGenerationJob（系譜の積み忘れを検出する）', () => {
  const REASON = 'character_consistency: 顔の造作が参照と違う'

  it('親だけを積んで理由を忘れた行は、そもそも作れない', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)

    /**
     * 系譜は generation_jobs の行に対で積む。片方だけの行は作成の時点で落とす。
     * ここを通してしまうと、何の作り直しか分からない Take が確定する。
     */
    const createWithoutReason = async () =>
      f.jobs.create({
        shotId: f.shot.id,
        specHash: f.specHash,
        requestedModel: 'AUTO',
        resolvedModel: MODEL.id,
        parentTakeId: parent.id,
      })

    await expect(createWithoutReason()).rejects.toThrow(/regenerationReason/)
  })

  it('理由を欠いた行が届いたら、投入する前に落とす', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)

    /**
     * 作成時の検証をすり抜けた行（直接 SQL で入れた・移行途中など）を想定する。
     * 課金する前に止めて、何が足りないかを code に残す。
     */
    const broken: GenerationJob = {
      ...f.job,
      parentTakeId: parent.id,
      regenerationReason: null,
    }
    const deps = {
      ...f.deps,
      generationJobs: { ...f.jobs, findById: () => Promise.resolve(broken) },
    }

    const outcome = await processGenerationJob(deps, { generationJobId: f.job.id })

    expect(outcome).toEqual({ state: 'failed', code: 'regeneration_reason_missing' })
    expect(f.provider.submitted()).toHaveLength(0)
    expect(f.takes.snapshot()).toHaveLength(1) // 親だけ
  })

  it('系譜をジョブデータに入れ子で積んだら落とす（旧形式）', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)

    /**
     * 移行前のジョブが Redis に残っているとこの形で届く。
     * 黙って捨てると、系譜を持っているつもりのジョブが親も理由も無い Take を作って終わる。
     * 落ちるのは投入前なので課金は発生しない。行に積み直せばよい。
     */
    await expect(
      processGenerationJob(f.deps, {
        generationJobId: f.job.id,
        lineage: { parentTakeId: parent.id, regenerationReason: REASON },
      }),
    ).rejects.toThrow(/generation_jobs の行/)

    expect(f.provider.submitted()).toHaveLength(0)
    expect(f.takes.snapshot()).toHaveLength(1) // 親だけ
  })

  it('系譜をジョブデータに平たく積んでも落とす', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)

    /** 既定の zod は未知のキーを落とす。`.strict()` にしてあるので落ちる。 */
    await expect(
      processGenerationJob(f.deps, {
        generationJobId: f.job.id,
        parentTakeId: parent.id,
        regenerationReason: REASON,
      }),
    ).rejects.toThrow(/generation_jobs の行/)

    expect(f.provider.submitted()).toHaveLength(0)
  })

  it('再生成の要求をそのまま積んだら、直し方が分かるエラーになる', async () => {
    const f = await buildFixture([SUCCEEDED])

    await expect(
      processGenerationJob(f.deps, {
        regeneration: {
          shotId: f.shot.id,
          projectId: f.project.id,
          parentTakeId: '01JBXV0000000000000000000A',
          reason: REASON,
          adjustment: {},
        },
      }),
    ).rejects.toThrow(/GenerationJob を系譜つきで作/)
  })
})

describe('pollDelayMs', () => {
  it('指数的に伸び、上限で頭打ちになる', () => {
    expect(pollDelayMs(1)).toBe(POLL_BACKOFF_BASE_MS)
    expect(pollDelayMs(2)).toBe(POLL_BACKOFF_BASE_MS * 2)
    expect(pollDelayMs(3)).toBe(POLL_BACKOFF_BASE_MS * 4)
    expect(pollDelayMs(50)).toBe(POLL_BACKOFF_MAX_MS)
  })
})

describe('processGenerationJob（状態の変化を出来事として流す）', () => {
  /** 流れた出来事はすべて契約（domain）を通ること。形がズレたらここで落ちる。 */
  const parsedEvents = (f: Fixture) => f.events.published().map((e) => ProjectEvent.parse(e))

  const jobEvents = (f: Fixture) =>
    parsedEvents(f).filter((e) => e.type === 'generation_job.status')

  it('ジョブを投入したら running の出来事を流す', async () => {
    const f = await buildFixture([{ state: 'pending', progress: null }])

    await processGenerationJob(f.deps, { generationJobId: f.job.id })

    const events = parsedEvents(f)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'generation_job.status',
      projectId: f.project.id,
      shotId: f.shot.id,
      jobId: f.job.id,
      status: 'running',
      // 開始時点では Take も理由も無い
      takeId: null,
      error: null,
    })
  })

  it('Take を確定したら Shot と ジョブ の 2 つを流す', async () => {
    const f = await buildFixture([SUCCEEDED])

    await runToCompletion(f)

    const take = f.takes.snapshot()[0]
    const events = parsedEvents(f)

    // running → shot.status(review) → generation_job.status(succeeded) の順
    expect(events.map((e) => e.type)).toEqual([
      'generation_job.status',
      'shot.status',
      'generation_job.status',
    ])
    expect(events[1]).toMatchObject({
      type: 'shot.status',
      projectId: f.project.id,
      shotId: f.shot.id,
      status: 'review',
    })
    expect(events[2]).toMatchObject({
      type: 'generation_job.status',
      projectId: f.project.id,
      shotId: f.shot.id,
      jobId: f.job.id,
      status: 'succeeded',
      takeId: take?.id,
      error: null,
    })
  })

  it('失敗したら理由の付いた出来事を流す（黙って失敗にしない）', async () => {
    const f = await buildFixture([
      {
        state: 'failed',
        error: { code: 'content_policy', message: '生成が拒否されました', retryable: false },
      },
    ])

    await runToCompletion(f)

    const failed = jobEvents(f).filter((e) => e.status === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      projectId: f.project.id,
      shotId: f.shot.id,
      jobId: f.job.id,
      status: 'failed',
      takeId: null,
      error: '生成が拒否されました',
    })
  })

  it('失敗の出来事の error は必ず中身を持つ', async () => {
    const f = await buildFixture([SUCCEEDED])
    // message が空のエラーでも「失敗」だけを流さない（Shot は読めている）
    const deps = {
      ...f.deps,
      projects: { ...f.deps.projects, findById: () => Promise.reject(new Error('')) },
    }

    await processGenerationJob(deps, { generationJobId: f.job.id })

    const failed = jobEvents(f).filter((e) => e.status === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.error?.trim()).not.toBe('')
  })

  it('Shot を読めなければ流さず、流せなかったことを残す', async () => {
    const f = await buildFixture([SUCCEEDED])
    const captured = createCapturingLogger()
    const deps = {
      ...f.deps,
      shots: { ...f.shots, findById: () => Promise.resolve(null) },
      logger: captured.logger,
    }

    const outcome = await processGenerationJob(deps, { generationJobId: f.job.id })

    expect(outcome).toEqual({ state: 'failed', code: 'shot_missing' })
    // projectId が分からないので流せない。だが黙って省かない（lessons L-015）
    expect(f.events.published()).toHaveLength(0)
    expect(captured.lines().some((l) => l.msg.includes('失敗の出来事を流せませんでした'))).toBe(
      true,
    )
  })

  it('publish が失敗しても Take は確定し、warn が残る', async () => {
    const f = await buildFixture([SUCCEEDED])
    const captured = createCapturingLogger()
    const deps = { ...f.deps, events: createFailingEvents(), logger: captured.logger }

    await processGenerationJob(deps, { generationJobId: f.job.id })
    const second = await processGenerationJob(deps, { generationJobId: f.job.id })

    /**
     * 通知は状態変更への上乗せ。届かなかったことを理由に Take を巻き戻さない
     * （`ProjectEventPublisher` の契約）。
     */
    expect(second.state).toBe('succeeded')
    expect(f.takes.snapshot()).toHaveLength(1)
    expect(f.jobs.snapshot()[0]?.status).toBe('succeeded')
    expect(f.shots.snapshot()[0]?.status).toBe('review')

    const warns = captured.lines().filter((l) => l.msg.includes('出来事を流せませんでした'))
    // running / shot.status / generation_job.status の 3 回ぶん
    expect(warns).toHaveLength(3)
    expect(warns.every((l) => l.jobId === f.job.id)).toBe(true)
  })

  it('at は流す側の時計を使う', async () => {
    const f = await buildFixture([{ state: 'pending', progress: null }])
    const at = new Date('2026-09-18T12:34:56.000Z')

    await processGenerationJob({ ...f.deps, now: () => at }, { generationJobId: f.job.id })

    expect(parsedEvents(f).map((e) => e.at)).toEqual([at.toISOString()])
  })
})

/**
 * 指摘の直しを添えたジョブ（PHASE 6.1）。
 *
 * **api が仕様へ織り込んだ直しを、worker も行から読んで同じように織り込む必要がある。**
 * 片側にしか無いと `specHash` が食い違い、`spec_drift` で必ず落ちる（L-012）。
 * ここが落ちると「直して作り直す」が画面上は成功して、生成だけが静かに死ぬ。
 */
describe('processGenerationJob — 指摘の直し（corrections）', () => {
  it('行の直しを仕様へ織り込むので spec_drift にならない', async () => {
    const f = await buildFixture([SUCCEEDED], createPhase1EmptyContextSource(), ['顔をもっと近く'])

    const outcome = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(outcome).toEqual({ state: 'submitted', providerJobRef: 'provider-job-1' })
    expect(f.provider.submitted()).toHaveLength(1)
  })

  it('直しが Provider へ渡る仕様に載り、プロンプトの末尾に付く', async () => {
    const f = await buildFixture([SUCCEEDED], createPhase1EmptyContextSource(), ['顔をもっと近く'])

    await processGenerationJob(f.deps, { generationJobId: f.job.id })

    const request = f.provider.submitted()[0]
    expect(request?.spec.corrections).toEqual(['顔をもっと近く'])
    // promptParts に入れるだけでは Provider に届かない。最終プロンプトに出ること。
    expect(request?.spec.prompt).toContain('顔をもっと近く')
  })

  it('直しの無いジョブの仕様にはキーが現れない', async () => {
    const f = await buildFixture([SUCCEEDED])

    await processGenerationJob(f.deps, { generationJobId: f.job.id })

    const request = f.provider.submitted()[0]
    expect(request === undefined ? true : 'corrections' in request.spec).toBe(false)
  })

  it('行の直しと仕様の直しが食い違えば spec_drift で止める（課金の前）', async () => {
    // 仕様は「顔をもっと近く」で組まれているのに、行には別の直しが入っている形。
    // api と worker がズレるとこうなる。**Provider へ投げる前に止まること**を見る。
    const f = await buildFixture([SUCCEEDED], createPhase1EmptyContextSource(), ['顔をもっと近く'])

    const drifted = await f.jobs.create({
      shotId: f.shot.id,
      specHash: f.specHash,
      requestedModel: 'AUTO',
      resolvedModel: MODEL.id,
      corrections: ['光を強く'],
    })

    const outcome = await processGenerationJob(f.deps, { generationJobId: drifted.id })

    expect(outcome).toEqual({ state: 'failed', code: 'spec_drift' })
    expect(f.provider.submitted()).toHaveLength(0)
  })
})

/**
 * 失敗したときに Shot を生成中から解放する（S1）。
 *
 * 生成に回すと API が Shot を `generating` にする。成功したときは worker が
 * `review` へ戻すが、**失敗したときに戻す経路が無かった**。
 * その結果、失敗した Shot は DB ごと生成中で固まり、リロードしても「生成中」、
 * 生成ボタンは押せないまま、二度と生成できなくなっていた。
 *
 * この経路はスタブに失敗の口が無かったため、**実 Provider を有料で回すまで
 * 一度も走らない**状態だった。ここで走らせる。
 */
describe('失敗したときの Shot の解放', () => {
  const FAILED: ProviderJobStatus = {
    state: 'failed',
    error: { code: 'provider_error', message: 'Provider が 500 を返しました', retryable: true },
  }

  /** 投入時点の状態。API が `generating` にしてから worker が受け取る。 */
  const startsGenerating = (f: Awaited<ReturnType<typeof buildFixture>>): void => {
    expect(f.shots.snapshot()[0]?.status).toBe('generating')
  }

  const shotStatusEvents = (f: Awaited<ReturnType<typeof buildFixture>>) =>
    f.events.published().flatMap((event) => (event.type === 'shot.status' ? [event.status] : []))

  it('Take が 1 本も無ければ要判断にする（生成中のままにしない）', async () => {
    const f = await buildFixture([FAILED])
    startsGenerating(f)

    await runToCompletion(f)

    expect(f.takes.snapshot()).toHaveLength(0)
    expect(f.shots.snapshot()[0]?.status).toBe('blocked')
    expect(shotStatusEvents(f)).toContain('blocked')
  })

  it('生成可能へ戻さない。失敗の痕跡を一覧から消さない', async () => {
    const f = await buildFixture([FAILED])

    await runToCompletion(f)

    const status = f.shots.snapshot()[0]?.status
    expect(status).not.toBe('ready')
    expect(status).not.toBe('generating')
  })

  it('失敗の理由を画面まで運ぶ（空にしない）', async () => {
    const f = await buildFixture([FAILED])

    await runToCompletion(f)

    const failure = f.events
      .published()
      .find((event) => event.type === 'generation_job.status' && event.status === 'failed')
    expect(failure).toBeDefined()
    if (failure?.type === 'generation_job.status') {
      expect(failure.error).toBeTruthy()
      expect(failure.error).not.toBe('')
      expect(failure.takeId).toBeNull()
    }
  })

  it('ほかのジョブがまだ走っていれば、状態を動かさない', async () => {
    const f = await buildFixture([FAILED])
    // 同じ Shot にもう 1 本。3 本頼んで 1 本だけ落ちる形。
    await f.jobs.create({
      shotId: f.shot.id,
      specHash: f.specHash,
      requestedModel: 'AUTO',
      resolvedModel: MODEL.id,
      corrections: [],
    })

    await runToCompletion(f)

    // まだ決着していないので生成中のまま。後続の成功／失敗が決める。
    expect(f.shots.snapshot()[0]?.status).toBe('generating')
    expect(shotStatusEvents(f)).not.toContain('blocked')
  })

  it('解放に失敗しても、失敗の報告そのものは止めない', async () => {
    const f = await buildFixture([FAILED])
    const broken: GenerationProcessorDeps = {
      ...f.deps,
      shots: {
        ...f.shots,
        updateStatus: () => Promise.reject(new Error('DB に書けません')),
      },
    }

    const first = await processGenerationJob(broken, { generationJobId: f.job.id })
    const second = await processGenerationJob(broken, { generationJobId: f.job.id })

    expect(first.state).toBe('submitted')
    expect(second).toEqual({ state: 'failed', code: 'provider_error' })
    // 状態は戻せなかったが、理由は流れている。
    expect(
      f.events
        .published()
        .some((event) => event.type === 'generation_job.status' && event.status === 'failed'),
    ).toBe(true)
  })
})

/**
 * 投入済みのジョブを、問い合わせの一時的な失敗で捨てない。
 *
 * `providerJobRef` があるということは Provider 側で生成が走っており、
 * 実 Provider ではその時点で**課金が確定している**。
 * 以前はここで `ProviderError.retryable` を見ずに `false` へ潰していたため、
 * 通信が 1 回揺れただけで終端の `failed` になり、払った生成が捨てられていた。
 * スタブは無料なので、実 Provider をつなぐまで誰も気づけない。
 */
describe('問い合わせが一時的に失敗したとき', () => {
  /** `ProviderId` は branded。素の文字列は渡せない（tsc でしか気付けない）。 */
  const TEST_PROVIDER_ID = ProviderIdSchema.parse('test')

  /** submit は成功し、その後の poll で投げる Provider。 */
  const pollThrows = (error: Error) => {
    const base = createTestProvider([MODEL], [{ state: 'pending', progress: null }])
    return {
      ...base,
      poll: () => Promise.reject(error),
    }
  }

  const withProvider = async (error: Error) => {
    const f = await buildFixture([{ state: 'pending', progress: null }])
    const deps: GenerationProcessorDeps = {
      ...f.deps,
      registry: createProviderRegistry([pollThrows(error)]),
    }
    // 1 回目で submit し、providerJobRef を持たせる。
    const first = await processGenerationJob(f.deps, { generationJobId: f.job.id })
    expect(first.state).toBe('submitted')
    return { f, deps }
  }

  it('やり直せる失敗なら捨てずに予約し直す', async () => {
    const { f, deps } = await withProvider(new ProviderError('503', TEST_PROVIDER_ID, true))

    const second = await processGenerationJob(deps, { generationJobId: f.job.id })

    expect(second.state).toBe('polling')
    expect(f.jobs.snapshot()[0]?.status).not.toBe('failed')
    expect(f.scheduler.scheduled().length).toBeGreaterThan(1)
  })

  it('やり直せない失敗は終端にする（いつまでも粘らない）', async () => {
    const { f, deps } = await withProvider(new ProviderError('401', TEST_PROVIDER_ID, false))

    const second = await processGenerationJob(deps, { generationJobId: f.job.id })

    expect(second.state).toBe('failed')
    expect(f.jobs.snapshot()[0]?.status).toBe('failed')
  })

  it('終端にするときも、やり直せたかどうかを記録する', async () => {
    const { f, deps } = await withProvider(new ProviderError('401', TEST_PROVIDER_ID, false))

    await processGenerationJob(deps, { generationJobId: f.job.id })

    expect(f.jobs.snapshot()[0]?.error?.retryable).toBe(false)
  })

  it('上限まで粘ったら諦める', async () => {
    const { f, deps } = await withProvider(new ProviderError('503', TEST_PROVIDER_ID, true))
    await f.jobs.update(f.job.id, { attempt: MAX_POLL_ATTEMPTS })

    const second = await processGenerationJob(deps, { generationJobId: f.job.id })

    expect(second.state).toBe('failed')
  })
})

/**
 * 生成先が作り始めた時刻（制作者 2026-10-04「まとめて動画生成依頼出したら、なんかカット２，３が作成中になってる」）。
 * vpipe は 1 本ずつ作り、送った 2 本目は向こうで順番待ちになる。送った時刻を「作り始めた」とすると、待っている 1 本も
 * 作成中に見え、経過も長く出る。**問い合わせで初めて「作成中」が返った時刻**を 1 度だけ残す。
 */
describe('processGenerationJob（生成先が作り始めた時刻）', () => {
  const PENDING: ProviderJobStatus = { state: 'pending', progress: null }
  const RUNNING: ProviderJobStatus = { state: 'running', progress: null }
  const at = (minutes: number): Date => new Date(Date.UTC(2026, 9, 4, 2, minutes, 0))
  const step = (f: Fixture, minutes: number) =>
    processGenerationJob({ ...f.deps, now: () => at(minutes) }, { generationJobId: f.job.id })
  const jobOf = (f: Fixture) => f.jobs.snapshot().find((job) => job.id === f.job.id)

  it('「待ち」の間は残さず、初めて「作成中」が返った時刻を 1 度だけ残す', async () => {
    const f = await buildFixture([PENDING, RUNNING, RUNNING])

    await step(f, 0) // 送る
    expect(jobOf(f)?.startedAt).toEqual(at(0))
    await step(f, 4) // 生成先で順番待ち
    expect(jobOf(f)?.providerStartedAt).toBeNull()
    await step(f, 8) // 作り始めた
    expect(jobOf(f)?.providerStartedAt).toEqual(at(8))
    await step(f, 9) // 作っている（書き換えない）
    expect(jobOf(f)?.providerStartedAt).toEqual(at(8))
  })

  it('Take の生成時間は、生成先が作り始めてから数える（順番待ちを含めない）', async () => {
    const f = await buildFixture([PENDING, RUNNING, SUCCEEDED])

    await step(f, 0)
    await step(f, 4)
    await step(f, 8)
    await step(f, 12)

    expect(f.takes.snapshot()[0]?.generationTimeSec).toBe(240)
  })
})
