import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SfxCue,
  TimelineClip,
  sfxPeakOffsetsOf,
  sfxSeedsUsedOf,
  TimelineClipId,
  newId,
  type CreateTimelineClipInput,
  type SfxJobSpec,
} from '@ixa/domain'
import { createInMemorySfxJobRepository } from '@ixa/generation/testing'
import {
  ProviderBusyError,
  type ProviderJobHandle,
  type SfxJobStatusFromProvider,
  type SfxProvider,
} from '@ixa/provider-core'
import { SFX_WORKFLOW_UNAVAILABLE_CODE, mossSfxModel, stableAudioSfxModel } from '@ixa/provider-music'
import { LocalServerRequestError } from '@ixa/provider-video'
import { createMemoryStorage } from '@ixa/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aProject,
  createRecordingEvents,
  createRecordingMediaQueue,
  inMemoryMediaAssets,
  inMemoryProjects,
  silentLogger,
} from '../../generation/__tests__/doubles.js'
import { createInMemoryLocalGpuLease, type LocalGpuLease } from '../../generation/local-gpu-lease.js'
import { failInterruptedSfxJob } from '../interrupted.js'
import { processSfxJob, type SfxProcessorDeps } from '../processor.js'

/**
 * 効果音を作る（ADR-0052）。GPU の順番を取り → 投入 → 待つ → 1 本ずつ素材にし、1 本目を効果音の段に置く。
 * 止めた・失敗したジョブは素材もクリップも作らない。
 */

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-sfx-processor-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = aProject()

const SPEC: SfxJobSpec = {
  cue: SfxCue.parse({ startSec: 3.75, durationSec: 1, prompt: 'cinematic impact hit', volume: 1.2 }),
  count: 2,
  seed: 7,
}

type FakeProvider = SfxProvider & { readonly calls: { submit: unknown[]; cancel: number; release: number } }

/** 偽の生成先。`statuses` を順に返す（最後のものを繰り返す）。 */
const fakeProvider = (
  statuses: readonly (SfxJobStatusFromProvider | Error)[],
  options: { readonly submitError?: Error } = {},
): FakeProvider => {
  const calls = { submit: [] as unknown[], cancel: 0, release: 0 }
  let index = 0
  const handle: ProviderJobHandle = {
    providerId: stableAudioSfxModel.providerId,
    modelId: stableAudioSfxModel.id,
    ref: 'job_REMOTE',
    submittedAt: new Date(),
  }
  return {
    id: stableAudioSfxModel.providerId,
    models: [stableAudioSfxModel, mossSfxModel],
    exclusiveResource: 'local-gpu',
    calls,
    submit: (request) => {
      calls.submit.push(request)
      return options.submitError === undefined ? Promise.resolve(handle) : Promise.reject(options.submitError)
    },
    poll: () => {
      const status = statuses[Math.min(index, statuses.length - 1)]
      index += 1
      if (status === undefined) return Promise.reject(new Error('状態がありません'))
      return status instanceof Error ? Promise.reject(status) : Promise.resolve(status)
    },
    cancel: () => {
      calls.cancel += 1
      return Promise.resolve()
    },
    release: () => {
      calls.release += 1
      return Promise.resolve()
    },
  }
}

const succeeded = async (count: number): Promise<SfxJobStatusFromProvider> => ({
  state: 'succeeded',
  outputs: await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const path = join(dir, `out-${String(index)}.wav`)
      await writeFile(path, `RIFF-${String(index)}`)
      return { path, durationSec: 1.05 + index, sampleRate: 44_100, channels: 2, seedUsed: 7 + 2 * index }
    }),
  ),
  costUsd: 0,
  raw: { workflow: 'stable-audio-3-sfx' },
})

/** 16 bit モノラルの WAV。`peakAt` 秒のあたりだけ大きい。 */
const peakWav = (peakAt: number, sec = 0.6, sampleRate = 8000): Uint8Array => {
  const frames = Math.round(sec * sampleRate)
  const buffer = Buffer.alloc(44 + frames * 2)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + frames * 2, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i += 1) {
    buffer.writeInt16LE(Math.abs(i / sampleRate - peakAt) < 0.005 ? 30000 : 500, 44 + i * 2)
  }
  return new Uint8Array(buffer)
}

const succeededWithPeak = async (peakAt: number): Promise<SfxJobStatusFromProvider> => {
  const path = join(dir, `peak-${String(peakAt)}.wav`)
  await writeFile(path, peakWav(peakAt))
  return {
    state: 'succeeded',
    outputs: [{ path, durationSec: 0.6, sampleRate: 8000, channels: 1, seedUsed: 7 }],
    costUsd: 0,
    raw: { workflow: 'stable-audio-3-sfx' },
  }
}

/** タイムラインのクリップの偽物。 */
const inMemoryClips = () => {
  let store: readonly TimelineClip[] = []
  return {
    snapshot: () => store,
    findByProject: (projectId: string) => Promise.resolve(store.filter((clip) => clip.projectId === projectId)),
    create: (input: CreateTimelineClipInput) => {
      const created = TimelineClip.parse({ ...input, id: newId(TimelineClipId), createdAt: new Date() })
      store = [...store, created]
      return Promise.resolve(created)
    },
  }
}

const setup = async (provider: FakeProvider | null, options: { readonly lease?: LocalGpuLease; readonly model?: string } = {}) => {
  const sfxJobs = createInMemorySfxJobRepository()
  const job = await sfxJobs.create({
    projectId: project.id,
    tool: 'stable_audio_sfx',
    model: options.model ?? stableAudioSfxModel.id,
    spec: SPEC,
  })
  const clips = inMemoryClips()
  const mediaAssets = inMemoryMediaAssets()
  const mediaQueue = createRecordingMediaQueue()
  const events = createRecordingEvents()
  const rescheduled: { data: unknown; delayMs: number }[] = []
  const lease = options.lease ?? createInMemoryLocalGpuLease()
  const deps: SfxProcessorDeps = {
    sfxJobs,
    projects: inMemoryProjects([project]),
    mediaAssets,
    timelineClips: clips,
    storage: createMemoryStorage(),
    adapters:
      provider === null
        ? []
        : [
            { provider, model: stableAudioSfxModel },
            { provider, model: mossSfxModel },
          ],
    localGpuLease: lease,
    scheduler: {
      reschedule: (data, delayMs) => {
        rescheduled.push({ data, delayMs })
        return Promise.resolve()
      },
    },
    mediaQueue,
    events,
    logger: silentLogger,
    pollIntervalMs: 0,
  }
  return { deps, job, sfxJobs, clips, mediaAssets, mediaQueue, events, rescheduled, lease }
}

describe('processSfxJob', () => {
  it('本数ぶん素材を作り、1 本目を効果音の段に置いて成功にする（冪等キーはジョブの ID）', async () => {
    const provider = fakeProvider([{ state: 'running', progress: 0.5 }, await succeeded(2)])
    const s = await setup(provider)

    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'succeeded' })

    expect(provider.calls.submit).toMatchObject([
      { model: stableAudioSfxModel, prompt: 'cinematic impact hit', durationSec: 1, count: 2, seed: 7, idempotencyKey: s.job.id },
    ])
    const assets = s.mediaAssets.snapshot()
    expect(assets).toHaveLength(2)
    expect(assets[0]).toMatchObject({ kind: 'audio', mimeType: 'audio/wav', origin: { type: 'generated_sfx', sfxJobId: s.job.id } })
    expect(s.mediaQueue.enqueued()).toHaveLength(2)

    const clips = s.clips.snapshot()
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({
      track: 'SFX',
      startSec: 3.75,
      durationSec: 1.05,
      content: { type: 'media', mediaAssetId: assets[0]?.id, inSec: 0, outSec: 1.05, volume: 1.2, fadeOutSec: 0.05 },
    })
    const done = s.sfxJobs.snapshot()[0]
    expect(done).toMatchObject({ status: 'succeeded', mediaAssetIds: assets.map((a) => a.id), timelineClipId: clips[0]?.id })
    expect(done?.providerRecord).toMatchObject({ providerJobRef: 'job_REMOTE', workflow: 'stable-audio-3-sfx' })
    expect(s.events.published().map((event) => event.type === 'sfx_job.status' && event.status)).toEqual(['running', 'succeeded'])
    expect(s.events.published().at(-1)).toMatchObject({ timelineClipId: clips[0]?.id })
    expect(provider.calls.release).toBe(1)
    expect(await s.lease.acquire('video-job', Date.now())).toEqual({ state: 'acquired' })
  })

  /** Stable Audio は同じ種・説明・長さならビット一致。中身で 1 つの素材にまとまっても、きっかけごとに置く。 */
  it('同じ中身の音を別のきっかけで作っても、それぞれの時刻に置く', async () => {
    const provider = fakeProvider([await succeeded(1)])
    const s = await setup(provider)
    const spec = (startSec: number): SfxJobSpec => ({ ...SPEC, count: 1, cue: { ...SPEC.cue, startSec } })
    const first = await s.sfxJobs.create({ projectId: project.id, tool: 'stable_audio_sfx', model: stableAudioSfxModel.id, spec: spec(1) })
    const second = await s.sfxJobs.create({ projectId: project.id, tool: 'stable_audio_sfx', model: stableAudioSfxModel.id, spec: spec(6) })

    expect(await processSfxJob(s.deps, { sfxJobId: first.id })).toEqual({ state: 'succeeded' })
    expect(await processSfxJob(s.deps, { sfxJobId: second.id })).toEqual({ state: 'succeeded' })

    expect(s.mediaAssets.snapshot()).toHaveLength(1)
    expect(s.clips.snapshot().map((clip) => clip.startSec)).toEqual([1, 6])
    const jobs = s.sfxJobs.snapshot()
    expect(jobs.find((j) => j.id === first.id)?.timelineClipId).toBe(s.clips.snapshot()[0]?.id)
    expect(jobs.find((j) => j.id === second.id)?.timelineClipId).toBe(s.clips.snapshot()[1]?.id)
  })

  it('入れたくない音を送り、できた音の種を素材と同じ順で記す', async () => {
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider)
    const job = await s.sfxJobs.create({
      projectId: project.id,
      tool: 'moss_sfx',
      model: mossSfxModel.id,
      spec: { ...SPEC, cue: SfxCue.parse({ ...SPEC.cue, negativePrompt: 'music, voice' }) },
    })
    await processSfxJob(s.deps, { sfxJobId: job.id })
    expect(provider.calls.submit).toMatchObject([{ negativePrompt: 'music, voice' }])
    const done = s.sfxJobs.snapshot().find((j) => j.id === job.id)
    expect(sfxSeedsUsedOf(done ?? { providerRecord: null, mediaAssetIds: [] })).toEqual([7, 9])
  })

  /** ADR-0054 追記。山で合わせる印のあるきっかけは、音の一番大きいところが時刻に来るよう前へ寄せる。 */
  it('山で合わせるきっかけは、測った山の秒だけ前へ寄せて置き、山の秒を記す', async () => {
    const provider = fakeProvider([await succeededWithPeak(0.2)])
    const s = await setup(provider)
    const job = await s.sfxJobs.create({
      projectId: project.id,
      tool: 'stable_audio_sfx',
      model: stableAudioSfxModel.id,
      spec: { ...SPEC, count: 1, cue: SfxCue.parse({ ...SPEC.cue, startSec: 5, align: { to: 'peak', notBeforeSec: 4 } }) },
    })
    expect(await processSfxJob(s.deps, { sfxJobId: job.id })).toEqual({ state: 'succeeded' })
    expect(s.clips.snapshot()[0]?.startSec).toBeCloseTo(4.8, 2)
    const done = s.sfxJobs.snapshot().find((j) => j.id === job.id)
    const [offset] = sfxPeakOffsetsOf(done ?? { providerRecord: null, mediaAssetIds: [] })
    expect(offset).toBeCloseTo(0.2, 2)
  })

  it('印の無いきっかけは、山を測っても時刻のまま置く', async () => {
    const provider = fakeProvider([await succeededWithPeak(0.2)])
    const s = await setup(provider)
    const job = await s.sfxJobs.create({
      projectId: project.id,
      tool: 'stable_audio_sfx',
      model: stableAudioSfxModel.id,
      spec: { ...SPEC, count: 1 },
    })
    await processSfxJob(s.deps, { sfxJobId: job.id })
    expect(s.clips.snapshot()[0]?.startSec).toBe(3.75)
  })

  it('キューが打ち切って失敗にした行を、遅れて終わっても成功に戻さない', async () => {
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider)
    const failOnPoll: SfxProvider = {
      ...provider,
      poll: async (handle) => {
        await failInterruptedSfxJob(s.deps, { sfxJobId: s.job.id }, 'stalled')
        return provider.poll(handle)
      },
    }
    await processSfxJob({ ...s.deps, adapters: [{ provider: failOnPoll, model: stableAudioSfxModel }] }, { sfxJobId: s.job.id })
    expect(s.sfxJobs.snapshot()[0]?.status).toBe('failed')
  })

  it('ジョブに記されたモデルで作る（MOSS は moss-sfx-v2）', async () => {
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider, { model: mossSfxModel.id })
    await processSfxJob(s.deps, { sfxJobId: s.job.id })
    expect(provider.calls.submit).toMatchObject([{ model: mossSfxModel }])
  })

  it('生成先が失敗を返したら理由を残して失敗にする（素材もクリップも作らない）', async () => {
    const provider = fakeProvider([
      { state: 'failed', error: { code: 'sfx_api_generation_failed', message: '効果音を作れませんでした: 落ちた', retryable: true } },
    ])
    const s = await setup(provider)

    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.sfxJobs.snapshot()[0]).toMatchObject({ status: 'failed', error: { code: 'sfx_api_generation_failed' } })
    expect(s.clips.snapshot()).toEqual([])
    expect(s.mediaAssets.snapshot()).toEqual([])
    expect(s.events.published().at(-1)).toMatchObject({ type: 'sfx_job.status', status: 'failed', error: '効果音を作れませんでした: 落ちた' })
    expect(provider.calls.release).toBe(1)
  })

  it('頼んだ本数より少なく返ってきたら成功にしない', async () => {
    const s = await setup(fakeProvider([await succeeded(1)]))
    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.sfxJobs.snapshot()[0]?.error).toMatchObject({ code: 'output_count_mismatch' })
    expect(s.clips.snapshot()).toEqual([])
  })

  it('GPU の順番が来ていなければ、投入せずに積み直す（ジョブは queued のまま）', async () => {
    const lease = createInMemoryLocalGpuLease()
    await lease.acquire('video-job', 0)
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider, { lease })

    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'waiting' })
    expect(provider.calls.submit).toEqual([])
    expect(s.rescheduled).toMatchObject([{ data: { sfxJobId: s.job.id } }])
    expect(s.sfxJobs.snapshot()[0]?.status).toBe('queued')
  })

  it('生成先で順番を待っている間（queued）は、仕上がりの上限を数えない', async () => {
    const pending: SfxJobStatusFromProvider = { state: 'pending', progress: null }
    const provider = fakeProvider([pending, pending, pending, await succeeded(2)])
    const s = await setup(provider)

    expect(await processSfxJob({ ...s.deps, maxWaitMs: 0 }, { sfxJobId: s.job.id })).toEqual({ state: 'succeeded' })
    expect(provider.calls.cancel).toBe(0)
  })

  it('走り出してから上限を過ぎたら、生成先を止めて時間切れにする', async () => {
    const provider = fakeProvider([{ state: 'running', progress: 0.1 }])
    const s = await setup(provider)

    expect(await processSfxJob({ ...s.deps, maxWaitMs: 0 }, { sfxJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.sfxJobs.snapshot()[0]?.error).toMatchObject({ code: 'timeout' })
    expect(provider.calls.cancel).toBe(1)
  })

  it('順番待ちにも別の上限があり、過ぎたら生成先を止めて時間切れにする', async () => {
    const provider = fakeProvider([{ state: 'pending', progress: null }])
    const s = await setup(provider)

    expect(await processSfxJob({ ...s.deps, maxQueuedMs: 0 }, { sfxJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.sfxJobs.snapshot()[0]?.error).toMatchObject({ code: 'timeout' })
    expect(provider.calls.cancel).toBe(1)
  })

  it('生成先が混んでいたら（429）失敗にせず積み直す', async () => {
    const provider = fakeProvider([], { submitError: new ProviderBusyError('混んでいます', stableAudioSfxModel.providerId, 45_000) })
    const s = await setup(provider)

    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'busy' })
    expect(s.rescheduled).toEqual([{ data: { sfxJobId: s.job.id }, delayMs: 45_000 }])
    expect(s.sfxJobs.snapshot()[0]?.status).toBe('queued')
    expect(s.events.published()).toEqual([])
  })

  it('待っている間に止められたら、生成先を止めて手を引く（クリップは置かない）', async () => {
    const provider = fakeProvider([{ state: 'running', progress: 0.1 }])
    const s = await setup(provider)
    const cancelOnPoll: SfxProvider = {
      ...provider,
      poll: async (handle) => {
        await s.sfxJobs.cancelActive(project.id)
        return provider.poll(handle)
      },
    }
    const deps = { ...s.deps, adapters: [{ provider: cancelOnPoll, model: stableAudioSfxModel }] }

    expect(await processSfxJob(deps, { sfxJobId: s.job.id })).toEqual({ state: 'skipped' })
    expect(provider.calls.cancel).toBe(1)
    expect(s.clips.snapshot()).toEqual([])
    expect(s.sfxJobs.snapshot()[0]?.status).toBe('cancelled')
  })

  it('置いた後で worker が落ちて同じジョブをやり直しても、クリップを二重に置かない', async () => {
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider)
    const crash = () => Promise.reject(new Error('worker が落ちた'))
    const crashing: SfxProcessorDeps = { ...s.deps, sfxJobs: { ...s.sfxJobs, markSucceeded: crash, markFailed: crash } }
    await expect(processSfxJob(crashing, { sfxJobId: s.job.id })).rejects.toThrow('worker が落ちた')
    expect(s.clips.snapshot()).toHaveLength(1)

    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'succeeded' })
    expect(s.clips.snapshot()).toHaveLength(1)
    expect(s.mediaAssets.snapshot()).toHaveLength(2)
    expect(s.sfxJobs.snapshot()[0]).toMatchObject({ status: 'succeeded', timelineClipId: s.clips.snapshot()[0]?.id })
  })

  it('思わぬ失敗は決まった文だけを画面へ出す（手元のパスなど実装の言葉を出さない）', async () => {
    const s = await setup(fakeProvider([new Error("ENOENT: no such file '/Users/someone/sfx-api/out.wav'")]))

    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'failed' })
    const error = s.sfxJobs.snapshot()[0]?.error
    expect(error).toEqual({ code: 'unexpected', message: '効果音を作れませんでした。少し待ってからもう一度作ってください。', retryable: true })
  })

  it('使えない workflow（503）は、provider の理由をそのまま出して、やり直せない失敗にする', async () => {
    const unavailable = new LocalServerRequestError(
      mossSfxModel.providerId,
      SFX_WORKFLOW_UNAVAILABLE_CODE,
      'MOSS SFX v2（手元）は今この Mac で使えません（weights missing）。',
      false,
      503,
    )
    const s = await setup(fakeProvider([], { submitError: unavailable }), { model: mossSfxModel.id })
    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.sfxJobs.snapshot()[0]?.error).toEqual({
      code: 'sfx_api_workflow_unavailable',
      message: 'MOSS SFX v2（手元）は今この Mac で使えません（weights missing）。',
      retryable: false,
    })
    expect(s.rescheduled).toEqual([])
  })

  it('この環境に口が無いモデルなら、選び直すよう言って失敗にする', async () => {
    const s = await setup(null)
    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.sfxJobs.snapshot()[0]?.error).toMatchObject({ code: 'provider_unavailable', retryable: false })
    expect(s.sfxJobs.snapshot()[0]?.error?.message).toMatch(/効果音の AI を選び直して/)
  })

  it('終わったジョブはもう作らない', async () => {
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider)
    await s.sfxJobs.cancelActive(project.id)
    expect(await processSfxJob(s.deps, { sfxJobId: s.job.id })).toEqual({ state: 'skipped' })
    expect(provider.calls.submit).toEqual([])
  })
})

describe('failInterruptedSfxJob', () => {
  it('キューに打ち切られたジョブを失敗にして知らせる。終わったジョブには触らない', async () => {
    const s = await setup(fakeProvider([]))
    await failInterruptedSfxJob(s.deps, { sfxJobId: s.job.id }, 'stalled')
    expect(s.sfxJobs.snapshot()[0]).toMatchObject({ status: 'failed', error: { code: 'interrupted' } })
    expect(s.events.published()).toMatchObject([{ type: 'sfx_job.status', status: 'failed' }])
    await failInterruptedSfxJob(s.deps, { sfxJobId: s.job.id }, 'stalled')
    expect(s.events.published()).toHaveLength(1)
  })
})
