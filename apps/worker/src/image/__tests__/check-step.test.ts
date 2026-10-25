import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ModelId,
  ProviderId,
  newId,
  type ImageCheckResult,
  type ImageGenerationJob,
} from '@ixa/domain'
import { retryImageJobInput } from '@ixa/db'
import { manualStartFrameOf, replaceManualStartFrame } from '@ixa/generation'
import {
  createInMemoryCharacterRepository,
  createInMemoryImageJobRepository,
  createInMemoryShotReferenceRepository,
} from '@ixa/generation/testing'
import { codexCliImageModel } from '@ixa/provider-image'
import { createMemoryStorage } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryLocalGpuLease } from '../../generation/local-gpu-lease.js'
import {
  aProject,
  aShot,
  createRecordingEvents,
  createRecordingMediaQueue,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryShots,
  silentLogger,
} from '../../generation/__tests__/doubles.js'
import { CHECK_FAILED_NOTE, CHECK_SKIPPED_NOTE } from '../check-step.js'
import { failInterruptedImageJob } from '../interrupted.js'
import { processImageJob, type ImageProcessorDeps } from '../processor.js'
import { fakeImageProvider } from './doubles.js'
import { checkDeps, fakeImageChecker, PASS, recordingImageQueue, RETRY, runImageJob } from './queue-doubles.js'

/**
 * 作った絵のチェックと、当てる・やり直すの判断（ADR-0055）。開始フレームで確かめる。
 * - 手元の AI で「やり直す」なら、上限（既定 2 回）までやり直す。**途中では前の絵を差し替えない**
 * - 当てるのはつながりの最後に 1 回だけ。合格した最新、無ければ点の最も良いもの
 * - 文章の AI が Claude でなければ、チェックを飛ばして今までどおり当てる
 */

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-image-check-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = aProject()
const shot = aShot(project, { description: '雨の夜道を走る赤いジャケットの少女' })

const queuedJob = (): ImageGenerationJob => ({
  id: newId(ImageGenerationJobIdSchema),
  projectId: project.id,
  kind: 'start_frame',
  shotId: shot.id,
  characterId: null,
  status: 'queued',
  providerId: ProviderId.parse('codex-cli'),
  modelId: ModelId.parse('codex-cli/image-gen'),
  referenceAssetIds: [],
  mediaAssetId: null,
  error: null,
  providerRecord: null,
  sentPrompt: null,
  retryOfJobId: null,
  attempt: 1,
  appliedAt: null,
  instruction: null,
  queuedAt: new Date(),
  startedAt: null,
  finishedAt: null,
})

type Options = {
  readonly results?: readonly ImageCheckResult[]
  readonly textTool?: 'claude_cli' | 'codex_cli'
  readonly local?: boolean
  readonly maxRetries?: number
  /** この回数目（1 から）の submit を断る。 */
  readonly failSubmitAt?: number
}

const setup = (options: Options = {}) => {
  const job = queuedJob()
  const base = fakeImageProvider(dir)
  const provider = {
    ...base,
    ...(options.local === false ? {} : { exclusiveResource: 'local-gpu' as const }),
    submit: (request: Parameters<typeof base.submit>[0]) =>
      base.requests.length + 1 === options.failSubmitAt ? Promise.reject(new Error('作れませんでした')) : base.submit(request),
  }
  const checker = fakeImageChecker(options.results ?? [PASS])
  const deps = {
    ...checkDeps(),
    checker,
    textTool: () => Promise.resolve(options.textTool ?? 'claude_cli'),
    maxRetries: options.maxRetries ?? 2,
    imageJobs: createInMemoryImageJobRepository([job]),
    shots: inMemoryShots([shot]),
    projects: inMemoryProjects([project]),
    characters: createInMemoryCharacterRepository(),
    concept: () => Promise.resolve(''),
    mediaAssets: inMemoryMediaAssets(),
    shotReferences: createInMemoryShotReferenceRepository(),
    storage: createMemoryStorage(),
    context: {
      charactersForShot: () => Promise.resolve([]),
      locationsForShot: () => Promise.resolve([]),
      manualReferencesForShot: () => Promise.resolve([]),
      previousShotLastFrame: () => Promise.resolve(null),
      startFrame: () => Promise.resolve(null),
    },
    adapters: [{ provider, model: codexCliImageModel }],
    localGpuLease: createInMemoryLocalGpuLease(),
    scheduler: { reschedule: () => Promise.resolve() },
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    workDir: join(dir, 'work'),
    logger: silentLogger,
    pollIntervalMs: 1,
    crop: async (input: string, output: string) => {
      await copyFile(input, output)
      return { width: 1536, height: 864 }
    },
  } satisfies ImageProcessorDeps
  return { job, deps, provider: base, checker }
}

const jobsOf = (deps: ReturnType<typeof setup>['deps']) =>
  [...deps.imageJobs.snapshot()].sort((a, b) => a.attempt - b.attempt)

describe('チェックして当てる', () => {
  it('合格なら、その絵を当てる（チェックは 1 回・費用を残す）', async () => {
    const { job, deps, checker } = setup()
    await runImageJob(deps, { imageJobId: job.id })

    const done = await deps.imageJobs.findById(job.id)
    expect(done?.status).toBe('succeeded')
    expect(done?.appliedAt).not.toBeNull()
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(done?.mediaAssetId)
    expect(checker.calls).toHaveLength(1)
    expect(deps.imageChecks.snapshot()).toMatchObject([{ imageJobId: job.id, outcome: 'checked', verdict: 'pass', costUsd: 0.02 }])
  })

  it('絵は手元のファイルで渡し、Shot の説明を指示として見せる', async () => {
    const { job, deps, checker } = setup()
    await runImageJob(deps, { imageJobId: job.id })
    const request = checker.calls[0]
    expect(request?.subject.path.startsWith(request.imageDir)).toBe(true)
    expect(request?.instruction).toContain('赤いジャケット')
  })

  it('文章の AI が Claude でなければ、チェックを飛ばして当てる（飛ばしたことを残す）', async () => {
    const { job, deps, checker } = setup({ textTool: 'codex_cli' })
    await runImageJob(deps, { imageJobId: job.id })

    expect(checker.calls).toHaveLength(0)
    expect(deps.imageChecks.snapshot()).toMatchObject([{ outcome: 'skipped', verdict: null, note: CHECK_SKIPPED_NOTE }])
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).not.toBeNull()
  })

  /** レビューの指摘（2026-10-19）。絵の素材が見つからなければ、空のキーで保管庫を読まずに、素材の ID を付けて投げる。 */
  it('絵の素材が見つからなければ、保管庫を空のキーで読まず、チェックせずに使うと残す', async () => {
    const { job, deps } = setup()
    await processImageJob(deps, { imageJobId: job.id })
    const keys: string[] = []
    const vanished = {
      ...deps,
      mediaAssets: { ...deps.mediaAssets, findById: () => Promise.resolve(null) },
      storage: { ...deps.storage, get: (key: string) => (keys.push(key), deps.storage.get(key)) },
    }
    await processImageJob(vanished, { imageJobId: job.id, step: 'check' })
    expect(keys).not.toContain('')
    expect(deps.imageChecks.snapshot()).toMatchObject([{ outcome: 'failed', note: CHECK_FAILED_NOTE }])
  })

  it('チェックの AI が落ちても、理由を残して当てる（合格に化けさせない）', async () => {
    const { job, deps } = setup()
    await runImageJob({ ...deps, checker: fakeImageChecker([]) }, { imageJobId: job.id })

    expect(deps.imageChecks.snapshot()).toMatchObject([{ outcome: 'failed', verdict: null, note: CHECK_FAILED_NOTE }])
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).not.toBeNull()
  })
})

describe('手元の AI での自動のやり直し', () => {
  it('「やり直す」なら、直し方を足して種を任せた新しいジョブで描き直す', async () => {
    const { job, deps, provider } = setup({ results: [RETRY(0.2), PASS] })
    await runImageJob(deps, { imageJobId: job.id })

    const jobs = jobsOf(deps)
    expect(jobs.map((candidate) => candidate.attempt)).toEqual([1, 2])
    expect(jobs[1]?.retryOfJobId).toBe(job.id)
    expect(provider.requests[1]?.prompt).toContain('exactly five fingers on each hand')
    expect(provider.requests[1]?.seed).toBeNull()
    expect(jobs[1]?.appliedAt).not.toBeNull()
    expect(jobs[0]?.appliedAt).toBeNull()
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(jobs[1]?.mediaAssetId)
  })

  it('やり直しの途中では前の絵を差し替えない', async () => {
    const { job, deps } = setup({ results: [RETRY(0.2), PASS] })
    const seen: (string | null)[] = []
    const checker = fakeImageChecker([RETRY(0.2), PASS])
    const spying = {
      ...checker,
      check: async (request: Parameters<typeof checker.check>[0]) => {
        seen.push(await manualStartFrameOf(deps.shotReferences, shot.id))
        return checker.check(request)
      },
    }
    await runImageJob({ ...deps, checker: spying }, { imageJobId: job.id })
    expect(seen).toEqual([null, null])
  })

  it('上限（既定 2 回）まで全部だめなら止め、点の最も良いものを当てる', async () => {
    const { job, deps, provider } = setup({ results: [RETRY(0.3), RETRY(0.5), RETRY(0.4)] })
    await runImageJob(deps, { imageJobId: job.id })

    const jobs = jobsOf(deps)
    expect(jobs.map((candidate) => candidate.attempt)).toEqual([1, 2, 3])
    expect(provider.requests).toHaveLength(3)
    expect(jobs.map((candidate) => candidate.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
    expect(jobs.filter((candidate) => candidate.appliedAt !== null).map((candidate) => candidate.attempt)).toEqual([2])
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(jobs[1]?.mediaAssetId)
  })

  /** チームリーダー 2026-10-19。文字と頭身だけの「やり直す」は、AI が言っても要確認に下げる（GPU を使わない）。 */
  it('意味の無い文字・頭身だけの「やり直す」は、やり直さずに要確認として当てる', async () => {
    const textOnly: ImageCheckResult = {
      verdict: 'retry',
      score: 0.4,
      issues: [
        { kind: 'text', message: '看板の文字が崩れています' },
        { kind: 'proportion', message: '頭身が参照より高い' },
      ],
      promptDelta: 'no lettering on signs',
    }
    const { job, deps, provider } = setup({ results: [textOnly] })
    await runImageJob(deps, { imageJobId: job.id })

    expect(provider.requests).toHaveLength(1)
    expect(deps.imageChecks.snapshot()).toMatchObject([{ verdict: 'review', issues: textOnly.issues }])
    expect((await deps.imageJobs.findById(job.id))?.appliedAt).not.toBeNull()
  })

  it('上限を 0 にすると自動でやり直さない', async () => {
    const { job, deps, provider } = setup({ results: [RETRY(0.3)], maxRetries: 0 })
    await runImageJob(deps, { imageJobId: job.id })
    expect(provider.requests).toHaveLength(1)
    expect((await deps.imageJobs.findById(job.id))?.appliedAt).not.toBeNull()
  })

  it('利用枠を使う AI（Codex）では自動でやり直さず、その絵を当てる', async () => {
    const { job, deps, provider } = setup({ results: [RETRY(0.3)], local: false })
    await runImageJob(deps, { imageJobId: job.id })
    expect(provider.requests).toHaveLength(1)
    expect((await deps.imageJobs.findById(job.id))?.appliedAt).not.toBeNull()
  })

  it('やり直しが失敗したら、前の絵を当てる', async () => {
    const { job, deps } = setup({ results: [RETRY(0.3)], failSubmitAt: 2 })
    await runImageJob(deps, { imageJobId: job.id })

    const jobs = jobsOf(deps)
    expect(jobs.map((candidate) => candidate.status)).toEqual(['succeeded', 'failed'])
    expect(jobs[0]?.appliedAt).not.toBeNull()
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(jobs[0]?.mediaAssetId)
  })

  it('チェック中・やり直し待ちの間は、動いているジョブに数える（重ねて頼ませない）', async () => {
    const { job, deps } = setup({ results: [RETRY(0.3), PASS] })
    await processImageJob(deps, { imageJobId: job.id })
    expect((await deps.imageJobs.findActiveByShot(shot.id))?.status).toBe('checking')
    await processImageJob(deps, deps.queue.pending.shift() ?? { imageJobId: job.id })
    expect((await deps.imageJobs.findActiveByShot(shot.id))?.status).toBe('queued')
  })
})

describe('投げ直し・止めた・打ち切られた', () => {
  it('チェックの手順を投げ直しても、二重に見ない・二重にやり直さない', async () => {
    const { job, deps, checker } = setup({ results: [RETRY(0.3), PASS] })
    await processImageJob(deps, { imageJobId: job.id })
    deps.queue.pending.length = 0
    // 1 度目は、やり直しを積んだ後、チェック中を終える前に落ちた。
    const crashing = {
      ...deps,
      imageJobs: { ...deps.imageJobs, finishChecking: () => Promise.reject(new Error('落ちた')) },
    }
    await expect(processImageJob(crashing, { imageJobId: job.id, step: 'check' })).rejects.toThrow('落ちた')
    // キューの投げ直し。
    const queue = recordingImageQueue()
    await processImageJob({ ...deps, queue }, { imageJobId: job.id, step: 'check' })
    expect(checker.calls).toHaveLength(1)
    // やり直しの行は増やさない。まだ待っているので、描く手順だけを積み直す。
    expect(jobsOf(deps)).toHaveLength(2)
    expect(queue.pending).toEqual([{ imageJobId: jobsOf(deps)[1]?.id }])
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('succeeded')
  })

  it('当て終えた後にチェックの手順が投げ直されても、当て直さない（人が替えた絵を戻さない）', async () => {
    const { job, deps } = setup()
    await processImageJob(deps, { imageJobId: job.id })
    deps.queue.pending.length = 0
    // 1 度目は、当てた後・チェック中を終える前に落ちた。
    const crashing = { ...deps, imageJobs: { ...deps.imageJobs, finishChecking: () => Promise.reject(new Error('落ちた')) } }
    await expect(processImageJob(crashing, { imageJobId: job.id, step: 'check' })).rejects.toThrow('落ちた')
    // その間に人が別の絵に替えた。
    const other = newId(ImageGenerationJobIdSchema) as unknown as NonNullable<ImageGenerationJob['mediaAssetId']>
    await replaceManualStartFrame(deps.shotReferences, shot.id, other)
    await processImageJob(deps, { imageJobId: job.id, step: 'check' })
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(other)
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('succeeded')
  })

  /** レビューの指摘（2026-10-19）。人が押したやり直しは新しいつながり。前に当てた絵で止めない。 */
  it('人が押したやり直しの絵は、前に当てた絵があっても当てる（利用枠を使う AI）', async () => {
    const { job, deps, provider } = setup({ results: [RETRY(0.3), RETRY(0.2)], local: false })
    await runImageJob(deps, { imageJobId: job.id })
    expect((await deps.imageJobs.findById(job.id))?.appliedAt).not.toBeNull()

    const manual = await deps.imageJobs.create(retryImageJobInput((await deps.imageJobs.findById(job.id)) ?? job))
    await runImageJob(deps, { imageJobId: manual.id })

    const redrawn = await deps.imageJobs.findById(manual.id)
    expect(provider.requests).toHaveLength(2)
    expect(redrawn?.appliedAt).not.toBeNull()
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBe(redrawn?.mediaAssetId)
  })

  it('当てる絵を選んでいる間に止められたら、当てない', async () => {
    const { job, deps } = setup()
    const stopping = {
      ...deps,
      imageChecks: {
        ...deps.imageChecks,
        findByJobIds: async (ids: Parameters<typeof deps.imageChecks.findByJobIds>[0]) => {
          await deps.imageJobs.cancelActive({ projectId: project.id })
          return deps.imageChecks.findByJobIds(ids)
        },
      },
    }
    await runImageJob(stopping, { imageJobId: job.id })
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBeNull()
  })

  /** レビューの指摘（2026-10-19）。やり直しの行を作った後、描く手順を積む前に落ちると、行が queued のまま残っていた。 */
  it('やり直しの行が待ったまま残っていれば、描く手順を積み直す（行は増やさない）', async () => {
    const { job, deps } = setup({ results: [RETRY(0.3), PASS] })
    await processImageJob(deps, { imageJobId: job.id })
    deps.queue.pending.length = 0
    const drawn = await deps.imageJobs.findById(job.id)
    const orphan = await deps.imageJobs.create(retryImageJobInput(drawn ?? job))

    await processImageJob(deps, { imageJobId: job.id, step: 'check' })

    expect(deps.queue.pending).toEqual([{ imageJobId: orphan.id }])
    expect(jobsOf(deps)).toHaveLength(2)
  })

  it('描く手順を投げ直してもチェック中なら描き直さず、チェックを積み直す', async () => {
    const { job, deps, provider } = setup()
    await processImageJob(deps, { imageJobId: job.id })
    deps.queue.pending.length = 0
    await processImageJob(deps, { imageJobId: job.id })
    expect(provider.requests).toHaveLength(1)
    expect(deps.queue.pending).toEqual([{ imageJobId: job.id, step: 'check' }])
  })

  it('チェック中に止めたら、当てない', async () => {
    const { job, deps } = setup()
    await processImageJob(deps, { imageJobId: job.id })
    await deps.imageJobs.cancelActive({ projectId: project.id })
    await processImageJob(deps, { imageJobId: job.id, step: 'check' })
    expect(await manualStartFrameOf(deps.shotReferences, shot.id)).toBeNull()
    expect((await deps.imageJobs.findById(job.id))?.status).toBe('cancelled')
  })

  it('チェックの手順が打ち切られたら、失敗にせず当てずに終える（固まって頼めなくならない）', async () => {
    const { job, deps } = setup()
    await processImageJob(deps, { imageJobId: job.id })
    await failInterruptedImageJob(deps, { imageJobId: job.id, step: 'check' }, 'stalled')
    const done = await deps.imageJobs.findById(job.id)
    expect(done?.status).toBe('succeeded')
    expect(done?.appliedAt).toBeNull()
    expect(await deps.imageJobs.findActiveByShot(shot.id)).toBeNull()
  })
})
