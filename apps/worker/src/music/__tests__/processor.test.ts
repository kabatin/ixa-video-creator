import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MusicTrack,
  MusicTrackId,
  newId,
  type CreateMusicTrackInput,
  type MusicJobSpec,
  type MusicTrackId as MusicTrackIdType,
} from '@ixa/domain'
import { createInMemoryMusicJobRepository } from '@ixa/generation/testing'
import {
  ProviderBusyError,
  type MusicJobStatusFromProvider,
  type MusicProvider,
  type ProviderJobHandle,
} from '@ixa/provider-core'
import { aceStepMusicModel } from '@ixa/provider-music'
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
import { failInterruptedMusicJob } from '../interrupted.js'
import { processMusicJob, type MusicProcessorDeps } from '../processor.js'

/**
 * 曲を作る（ADR-0048）。GPU の順番を取り → 投入 → 待つ → 1 曲ずつ素材・楽曲にして解析へ回す。
 * マスターは作品にマスターが無いときの 1 曲目だけ。止めた・失敗したジョブは楽曲を作らない。
 */

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-music-processor-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const project = aProject()

const SPEC: MusicJobSpec = {
  prompt: 'j-pop, upbeat',
  lyrics: '',
  durationSec: 30,
  instrumental: true,
  seed: null,
  count: 2,
  title: 'テーマ',
}

type FakeProvider = MusicProvider & {
  readonly calls: { submit: unknown[]; cancel: number; release: number }
}

/** 偽の生成先。`statuses` を順に返す（最後のものを繰り返す）。 */
const fakeProvider = (
  statuses: readonly (MusicJobStatusFromProvider | Error)[],
  options: { readonly submitError?: Error } = {},
): FakeProvider => {
  const calls = { submit: [] as unknown[], cancel: 0, release: 0 }
  let index = 0
  const handle: ProviderJobHandle = {
    providerId: aceStepMusicModel.providerId,
    modelId: aceStepMusicModel.id,
    ref: 'job_REMOTE',
    submittedAt: new Date(),
  }
  return {
    id: aceStepMusicModel.providerId,
    models: [aceStepMusicModel],
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

const wavFiles = async (count: number): Promise<readonly { path: string; durationSec: number }[]> =>
  Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const path = join(dir, `out-${String(index)}.wav`)
      await writeFile(path, `RIFF-${String(index)}`)
      return { path, durationSec: 30.2 }
    }),
  )

const succeeded = async (count: number): Promise<MusicJobStatusFromProvider> => ({
  state: 'succeeded',
  outputs: await wavFiles(count),
  seedUsed: 42,
  costUsd: 0,
  raw: { workflow: 'ace-step-1.5' },
})

/** 楽曲の偽物。最初の 1 曲は必ずマスター（実物と同じ規則）。 */
const inMemoryTracks = (seed: readonly MusicTrack[] = []) => {
  let store: readonly MusicTrack[] = seed
  return {
    snapshot: () => store,
    findByProject: (projectId: string) => Promise.resolve(store.filter((track) => track.projectId === projectId)),
    create: (input: CreateMusicTrackInput) => {
      const isMaster = store.length === 0 ? true : input.isMaster === true
      const created = MusicTrack.parse({ ...input, isMaster, id: newId(MusicTrackId) })
      store = [...store.map((track) => (isMaster ? { ...track, isMaster: false } : track)), created]
      return Promise.resolve(created)
    },
  }
}

const setup = async (
  provider: FakeProvider | null,
  options: { readonly tracks?: readonly MusicTrack[]; readonly lease?: LocalGpuLease; readonly spec?: MusicJobSpec } = {},
) => {
  const musicJobs = createInMemoryMusicJobRepository()
  const job = await musicJobs.create({ projectId: project.id, tool: 'ace_step', model: aceStepMusicModel.id, spec: options.spec ?? SPEC })
  const tracks = inMemoryTracks(options.tracks)
  const mediaAssets = inMemoryMediaAssets()
  const mediaQueue = createRecordingMediaQueue()
  const events = createRecordingEvents()
  const analyzed: MusicTrackIdType[] = []
  const rescheduled: { data: unknown; delayMs: number }[] = []
  const lease = options.lease ?? createInMemoryLocalGpuLease()
  const deps: MusicProcessorDeps = {
    musicJobs,
    projects: inMemoryProjects([project]),
    musicTracks: tracks,
    mediaAssets,
    storage: createMemoryStorage(),
    adapters: provider === null ? [] : [{ provider, model: aceStepMusicModel }],
    localGpuLease: lease,
    scheduler: {
      reschedule: (data, delayMs) => {
        rescheduled.push({ data, delayMs })
        return Promise.resolve()
      },
    },
    mediaQueue,
    analysisQueue: {
      enqueue: (id) => {
        analyzed.push(id)
        return Promise.resolve()
      },
    },
    events,
    logger: silentLogger,
    pollIntervalMs: 0,
  }
  return { deps, job, musicJobs, tracks, mediaAssets, mediaQueue, events, analyzed, rescheduled, lease }
}

describe('processMusicJob', () => {
  it('曲の数ぶん素材と楽曲を作り、解析へ回して成功にする（冪等キーはジョブの ID）', async () => {
    const provider = fakeProvider([{ state: 'running', progress: 0.3 }, await succeeded(2)])
    const s = await setup(provider)

    expect(await processMusicJob(s.deps, { musicJobId: s.job.id })).toEqual({ state: 'succeeded' })

    expect(provider.calls.submit).toMatchObject([
      { prompt: 'j-pop, upbeat', durationSec: 30, instrumental: true, count: 2, idempotencyKey: s.job.id },
    ])
    expect(s.mediaAssets.snapshot()).toHaveLength(2)
    expect(s.mediaAssets.snapshot()[0]).toMatchObject({
      kind: 'audio',
      mimeType: 'audio/wav',
      origin: { type: 'generated_music', musicJobId: s.job.id },
    })
    expect(s.mediaQueue.enqueued()).toHaveLength(2)
    const tracks = s.tracks.snapshot()
    expect(tracks.map((track) => track.title)).toEqual(['テーマ 1', 'テーマ 2'])
    expect(tracks.map((track) => track.isMaster)).toEqual([true, false])
    expect(s.analyzed).toEqual(tracks.map((track) => track.id))
    const done = s.musicJobs.snapshot()[0]
    expect(done).toMatchObject({ status: 'succeeded', musicTrackIds: tracks.map((track) => track.id) })
    expect(done?.providerRecord).toMatchObject({ providerJobRef: 'job_REMOTE', workflow: 'ace-step-1.5' })
    expect(s.events.published().map((event) => event.type === 'music_job.status' && event.status)).toEqual(['running', 'succeeded'])
    expect(provider.calls.release).toBe(1)
    // GPU の順番は返してある。
    expect(await s.lease.acquire('video-job', Date.now())).toEqual({ state: 'acquired' })
  })

  it('作品に既にマスターがあれば、作った曲をマスターにしない', async () => {
    const master = MusicTrack.parse({ id: newId(MusicTrackId), projectId: project.id, mediaAssetId: newId(MusicTrackId), title: '本番', isMaster: true })
    const s = await setup(fakeProvider([await succeeded(2)]), { tracks: [master] })

    await processMusicJob(s.deps, { musicJobId: s.job.id })

    expect(s.tracks.snapshot().filter((track) => track.isMaster).map((track) => track.title)).toEqual(['本番'])
  })

  it('生成先が失敗を返したら理由を残して失敗にする（楽曲は作らない）', async () => {
    const provider = fakeProvider([
      { state: 'failed', error: { code: 'ace_step_generation_failed', message: '曲を作れませんでした: 落ちた', retryable: true } },
    ])
    const s = await setup(provider)

    expect(await processMusicJob(s.deps, { musicJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.musicJobs.snapshot()[0]).toMatchObject({ status: 'failed', error: { code: 'ace_step_generation_failed' } })
    expect(s.tracks.snapshot()).toEqual([])
    expect(s.events.published().at(-1)).toMatchObject({ type: 'music_job.status', status: 'failed', error: '曲を作れませんでした: 落ちた' })
    expect(provider.calls.release).toBe(1)
  })

  it('頼んだ数より少なく返ってきたら成功にしない', async () => {
    const s = await setup(fakeProvider([await succeeded(1)]))

    expect(await processMusicJob(s.deps, { musicJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.musicJobs.snapshot()[0]?.error).toMatchObject({ code: 'output_count_mismatch' })
    expect(s.tracks.snapshot()).toEqual([])
  })

  it('GPU の順番が来ていなければ、投入せずに積み直す（ジョブは queued のまま）', async () => {
    const lease = createInMemoryLocalGpuLease()
    await lease.acquire('video-job', 0)
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider, { lease })

    expect(await processMusicJob(s.deps, { musicJobId: s.job.id })).toEqual({ state: 'waiting' })
    expect(provider.calls.submit).toEqual([])
    expect(s.rescheduled).toMatchObject([{ data: { musicJobId: s.job.id } }])
    expect(s.rescheduled[0]?.delayMs).toBeGreaterThan(0)
    expect(s.musicJobs.snapshot()[0]?.status).toBe('queued')
  })

  it('生成先が混んでいたら（429）失敗にせず積み直す', async () => {
    const provider = fakeProvider([], { submitError: new ProviderBusyError('混んでいます', aceStepMusicModel.providerId, 45_000) })
    const s = await setup(provider)

    expect(await processMusicJob(s.deps, { musicJobId: s.job.id })).toEqual({ state: 'busy' })
    expect(s.rescheduled).toEqual([{ data: { musicJobId: s.job.id }, delayMs: 45_000 }])
    expect(s.musicJobs.snapshot()[0]?.status).not.toBe('failed')
  })

  it('待っている間に止められたら、生成先を止めて手を引く（楽曲は作らない）', async () => {
    const provider = fakeProvider([{ state: 'running', progress: 0.1 }])
    const s = await setup(provider)
    const cancelOnPoll: MusicProvider = {
      ...provider,
      poll: async (handle) => {
        await s.musicJobs.cancelActive(project.id)
        return provider.poll(handle)
      },
    }
    const deps = { ...s.deps, adapters: [{ provider: cancelOnPoll, model: aceStepMusicModel }] }

    expect(await processMusicJob(deps, { musicJobId: s.job.id })).toEqual({ state: 'skipped' })
    expect(provider.calls.cancel).toBe(1)
    expect(s.tracks.snapshot()).toEqual([])
    expect(s.musicJobs.snapshot()[0]?.status).toBe('cancelled')
  })

  it('この環境に口が無いモデルなら、選び直すよう言って失敗にする', async () => {
    const s = await setup(null)

    expect(await processMusicJob(s.deps, { musicJobId: s.job.id })).toEqual({ state: 'failed' })
    expect(s.musicJobs.snapshot()[0]?.error).toMatchObject({ code: 'provider_unavailable', retryable: false })
  })

  it('終わったジョブはもう作らない', async () => {
    const provider = fakeProvider([await succeeded(2)])
    const s = await setup(provider)
    await s.musicJobs.cancelActive(project.id)

    expect(await processMusicJob(s.deps, { musicJobId: s.job.id })).toEqual({ state: 'skipped' })
    expect(provider.calls.submit).toEqual([])
  })
})

describe('failInterruptedMusicJob', () => {
  it('キューに打ち切られたジョブを失敗にして知らせる。終わったジョブには触らない', async () => {
    const s = await setup(fakeProvider([]))

    await failInterruptedMusicJob(s.deps, { musicJobId: s.job.id }, 'stalled')
    expect(s.musicJobs.snapshot()[0]).toMatchObject({ status: 'failed', error: { code: 'interrupted' } })
    expect(s.events.published()).toMatchObject([{ type: 'music_job.status', status: 'failed' }])

    await failInterruptedMusicJob(s.deps, { musicJobId: s.job.id }, 'stalled')
    expect(s.events.published()).toHaveLength(1)
  })
})
