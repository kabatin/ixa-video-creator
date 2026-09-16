import {
  createPhase1EmptyContextSource,
  type GenerationContextSource,
  type GenerationJob,
  type ShotId,
  type Take,
} from '@ixa/domain'
import { createProviderRegistry } from '@ixa/provider-core'
import type { ProviderJobStatus } from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it, vi } from 'vitest'
import type { DownloadedObject } from '../download.js'
import {
  POLL_BACKOFF_BASE_MS, POLL_BACKOFF_MAX_MS, pollDelayMs, processGenerationJob,
  type GenerationProcessorDeps,
} from '../processor.js'
import { MAX_REGENERATION_REASON_LENGTH } from '../lineage.js'
import { rebuildSpec } from '../spec.js'
import {
  aCharacterBundle, aProject, aShot, contextWith, createRecordingMediaQueue,
  createRecordingScheduler, createTestProvider, inMemoryJobs, inMemoryMediaAssets,
  inMemoryProjects, inMemoryShots, inMemoryTakes, silentLogger, testModel,
} from './doubles.js'

const MODEL = testModel()

/** 実ダウンロードはしない。キーだけ受け取って結果を返す。 */
const fakeDownload = vi.fn(
  (options: { key: string }): Promise<DownloadedObject> =>
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
) => {
  const project = aProject()
  const shot = aShot(project)
  const { specHash } = await rebuildSpec(context, shot, project, MODEL)

  const jobs = inMemoryJobs()
  const job: GenerationJob = await jobs.create({
    shotId: shot.id,
    specHash,
    requestedModel: 'AUTO',
    resolvedModel: MODEL.id,
  })

  const shots = inMemoryShots([shot])
  const takes = inMemoryTakes()
  const mediaAssets = inMemoryMediaAssets()
  const scheduler = createRecordingScheduler()
  const mediaQueue = createRecordingMediaQueue()
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
    logger: silentLogger,
    download: fakeDownload,
  }

  return {
    deps, job, shot, project, jobs, shots, takes, mediaAssets, scheduler, mediaQueue, specHash,
    provider,
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
    createPhase1EmptyContextSource(), f.shot, f.project, MODEL,
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

  it('成功したら MediaAsset と Take を作り、Shot を review にする', async () => {
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

  it('通常の生成で作った Take は親も理由も持たない', async () => {
    const f = await buildFixture([SUCCEEDED])

    await runToCompletion(f)

    const take = f.takes.snapshot()[0]
    expect(take?.parentTakeId).toBeNull()
    expect(take?.regenerationReason).toBeNull()
  })

  it('再生成のジョブデータから作った Take が親と理由を持つ', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)
    const data = {
      generationJobId: f.job.id,
      lineage: { parentTakeId: parent.id, regenerationReason: REASON },
    }

    await processGenerationJob(f.deps, data)
    const second = await processGenerationJob(f.deps, data)

    expect(second.state).toBe('succeeded')
    const created = f.takes.snapshot().find((t) => t.id !== parent.id)
    expect(created?.parentTakeId).toBe(parent.id)
    expect(created?.regenerationReason).toBe(REASON)
  })

  it('ポーリングで入れ直すときも系譜を運ぶ', async () => {
    const f = await buildFixture([{ state: 'running', progress: 0.3 }])
    const parent = await seedParentTake(f)
    const lineage = { parentTakeId: parent.id, regenerationReason: REASON }
    const data = { generationJobId: f.job.id, lineage }

    await processGenerationJob(f.deps, data)
    await processGenerationJob(f.deps, data)

    /**
     * 系譜を知っているのはジョブデータだけ（generation_jobs に列が無い）。
     * 入れ直しで落とすと、完了する頃には再生成だったことが分からなくなる。
     */
    expect(f.scheduler.scheduled()).toHaveLength(2)
    for (const scheduled of f.scheduler.scheduled()) {
      expect(scheduled.data).toEqual(data)
    }
  })

  it('親が実在しなければ投入する前に失敗させる（課金しない）', async () => {
    const f = await buildFixture([SUCCEEDED])

    const outcome = await processGenerationJob(f.deps, {
      generationJobId: f.job.id,
      lineage: { parentTakeId: '01JBXV0000000000000000000A', regenerationReason: REASON },
    })

    expect(outcome).toEqual({ state: 'failed', code: 'parent_take_missing' })
    expect(f.provider.submitted()).toHaveLength(0)
    expect(f.takes.snapshot()).toHaveLength(0)
    expect(f.jobs.snapshot()[0]?.error?.retryable).toBe(false)
  })

  it('親が別の Shot の Take なら投入する前に失敗させる', async () => {
    const f = await buildFixture([SUCCEEDED])
    const otherShot = aShot(f.project)
    const parent = await seedParentTake(f, otherShot.id)

    const outcome = await processGenerationJob(f.deps, {
      generationJobId: f.job.id,
      lineage: { parentTakeId: parent.id, regenerationReason: REASON },
    })

    expect(outcome).toEqual({ state: 'failed', code: 'parent_take_shot_mismatch' })
    expect(f.provider.submitted()).toHaveLength(0)
  })

  it('完了までに親が消えていたら理由だけ残して Take を確定する', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)
    const data = {
      generationJobId: f.job.id,
      lineage: { parentTakeId: parent.id, regenerationReason: REASON },
    }

    await processGenerationJob(f.deps, data)
    // 投入と完了の間に親が消えた状態を作る
    const withoutParent = {
      ...f.deps,
      takes: { ...f.takes, findById: () => Promise.resolve(null) },
    }
    const second = await processGenerationJob(withoutParent, data)

    /**
     * 生成は成功していて課金も済んでいる。親を辿れないことを理由に捨てない。
     * 理由を残すことで「最初の生成」と「親を失った再生成」が区別できる（L-015）。
     */
    expect(second.state).toBe('succeeded')
    const created = f.takes.snapshot().find((t) => t.id !== parent.id)
    expect(created?.parentTakeId).toBeNull()
    expect(created?.regenerationReason).toBe(REASON)
    expect(f.jobs.snapshot()[0]?.status).toBe('succeeded')
  })

  it('親だけ・理由だけの中途半端な系譜はジョブデータの時点で弾く', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)

    await expect(
      processGenerationJob(f.deps, {
        generationJobId: f.job.id,
        lineage: { parentTakeId: parent.id },
      }),
    ).rejects.toThrow()

    await expect(
      processGenerationJob(f.deps, {
        generationJobId: f.job.id,
        lineage: { parentTakeId: parent.id, regenerationReason: '' },
      }),
    ).rejects.toThrow()

    await expect(
      processGenerationJob(f.deps, {
        generationJobId: f.job.id,
        lineage: {
          parentTakeId: parent.id,
          regenerationReason: 'x'.repeat(MAX_REGENERATION_REASON_LENGTH + 1),
        },
      }),
    ).rejects.toThrow()

    expect(f.provider.submitted()).toHaveLength(0)
  })

  it('系譜を入れ子にし忘れて平たく積んだら黙って捨てずに落とす', async () => {
    const f = await buildFixture([SUCCEEDED])
    const parent = await seedParentTake(f)

    /**
     * 既定の zod は未知のキーを落とす。落としたまま通すと、親も理由も無い Take が
     * 「最初の生成」として確定してしまい、後から直せない（Take は Immutable）。
     */
    await expect(
      processGenerationJob(f.deps, {
        generationJobId: f.job.id,
        parentTakeId: parent.id,
        regenerationReason: REASON,
      }),
    ).rejects.toThrow()

    expect(f.provider.submitted()).toHaveLength(0)
    expect(f.takes.snapshot()).toHaveLength(1) // 親だけ
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
    ).rejects.toThrow(/GenerationJob を作/)
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
