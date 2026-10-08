import {
  createPhase1EmptyContextSource,
  ModelId,
  ProviderId,
  type GenerationJobId,
} from '@ixa/domain'
import {
  createProviderRegistry,
  ProviderBusyError,
  type ProviderJobStatus,
  type VideoModelDescriptor,
  type VideoProvider,
} from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { SUBMIT_BUSY_DEFAULT_DELAY_MS, SUBMIT_BUSY_HEAD_MIN_DELAY_MS } from '../busy.js'
import { describe, expect, it, vi } from 'vitest'
import type { DownloadedObject } from '../download.js'
import {
  createInMemoryLocalGpuLease,
  createUnprotectedLocalGpuLease,
  LOCAL_GPU_LEASE_TTL_MS,
  LOCAL_GPU_LINE_STALE_MS,
  type LocalGpuLease,
} from '../local-gpu-lease.js'
import { processGenerationJob, type GenerationProcessorDeps } from '../processor.js'
import { rebuildSpec } from '../spec.js'
import {
  aProject,
  aShot,
  createCapturingLogger,
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
  TEST_CAPABILITIES,
} from './doubles.js'

/**
 * この機械の GPU を 1 本ずつに揃える（ADR-0040）。
 *
 * 手元の生成サーバは 2 台ある（vpipe-api の MiniMax H3・wan-api の Wan 2.2）。**サーバ同士は
 * 互いを知らない**ので、両方を有効にすると 2 本が同時に 32GB のメモリを取り合う。
 * 止められるのは投入する側（worker）だけなので、ここで順番を作っていることを確かめる。
 */

const localModel = (providerId: string, id: string): VideoModelDescriptor => ({
  id: ModelId.parse(id),
  providerId: ProviderId.parse(providerId),
  label: id,
  capabilities: TEST_CAPABILITIES,
  qualities: {
    characterConsistency: 0.5,
    motion: 0.5,
    physics: 0.5,
    cameraControl: 0.5,
    promptAdherence: 0.5,
  },
  economics: { costPerSecondUsd: 0, typicalLatencySec: 420 },
  routable: false,
})

/** MiniMax H3（vpipe）と Wan（wan）に相当する 2 台。どちらも同じ GPU を名乗る。 */
const VPIPE_MODEL = localModel('vpipe', 'vpipe/minimax-h3-turbo-draft')
const WAN_MODEL = localModel('wan', 'wan/wan2.2-ti2v-5b-draft')
/** 3 本目の列を作るためのもう 1 台（整理券の試験用）。同じ GPU を名乗る。 */
const THIRD_MODEL = localModel('third', 'third/local-draft')
/** 雲の上の Provider（fal）に相当。GPU を名乗らない。 */
const CLOUD_MODEL = localModel('fal', 'fal/seedance-like')

/** 実ダウンロードはしない。キーだけ受け取って結果を返す（`processor.test.ts` と同じ形）。 */
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
  // 手元のファイルは実在が要るので、取り込みは URL の経路で試す（確かめたいのは順番の返し方）。
  output: { type: 'remote' as const, url: 'https://cdn.example.com/out.mp4' },
  seedUsed: 4242,
  costUsd: 0,
  raw: { quality: 'draft', output: { durationSec: 4 }, queuedSec: 30, renderSec: 420 },
}

const localProvider = (
  model: VideoModelDescriptor,
  statuses: readonly ProviderJobStatus[] = [{ state: 'running', progress: 0.1 }],
): VideoProvider & { readonly submitted: () => readonly unknown[] } => ({
  ...createTestProvider([model], statuses),
  exclusiveResource: 'local-gpu',
})

const cloudProvider = (statuses: readonly ProviderJobStatus[] = [{ state: 'running', progress: 0.1 }]) =>
  createTestProvider([CLOUD_MODEL], statuses)

/**
 * Shot と GenerationJob を**モデルごとに 1 組ずつ**用意する。
 * 2 本の生成を同時に積んだ状態（別々の Shot・別々のモデル）を作るのが目的。
 */
const buildFixture = async (options: {
  readonly providers: readonly VideoProvider[]
  readonly models: readonly VideoModelDescriptor[]
  readonly lease?: LocalGpuLease
  readonly logger?: GenerationProcessorDeps['logger']
}) => {
  const context = createPhase1EmptyContextSource()
  const project = aProject()
  const jobs = inMemoryJobs()
  const scheduler = createRecordingScheduler()
  const shots = options.models.map(() => aShot(project))

  const jobIds = new Map<string, GenerationJobId>()
  for (const [index, model] of options.models.entries()) {
    const shot = shots[index]
    if (shot === undefined) throw new Error('Shot が足りません')
    const { specHash } = await rebuildSpec(context, shot, project, model)
    const job = await jobs.create({
      shotId: shot.id,
      specHash,
      requestedModel: model.id,
      resolvedModel: model.id,
      corrections: [],
    seed: null,
    })
    jobIds.set(model.id, job.id)
  }

  const deps: GenerationProcessorDeps = {
    localGpuLease: options.lease ?? createInMemoryLocalGpuLease(),
    generationJobs: jobs,
    shots: inMemoryShots(shots),
    projects: inMemoryProjects([project]),
    takes: inMemoryTakes(),
    mediaAssets: inMemoryMediaAssets(),
    storage: createMemoryStorage(),
    registry: createProviderRegistry(options.providers),
    context,
    scheduler,
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    logger: options.logger ?? silentLogger,
    download: fakeDownload,
  }

  const jobIdFor = (model: VideoModelDescriptor): GenerationJobId => {
    const id = jobIds.get(model.id)
    if (id === undefined) throw new Error(`${model.id} のジョブがありません`)
    return id
  }

  return {
    deps,
    jobs,
    scheduler,
    jobIdFor,
    runFor: (jobId: GenerationJobId) => processGenerationJob(deps, { generationJobId: jobId }),
  }
}

describe('ローカルの生成は 1 本ずつ', () => {
  it('H3 と Wan を同時に積んでも、2 本目は投入されず queued のまま待つ', async () => {
    const vpipe = localProvider(VPIPE_MODEL)
    const wan = localProvider(WAN_MODEL)
    const f = await buildFixture({ providers: [vpipe, wan], models: [VPIPE_MODEL, WAN_MODEL] })

    const first = f.jobIdFor(VPIPE_MODEL)
    const second = f.jobIdFor(WAN_MODEL)

    expect(await f.runFor(first)).toMatchObject({ state: 'submitted' })
    const before = await f.jobs.findById(second)
    const outcome = await f.runFor(second)

    // 2 本目は「生成先が混んでいる」と同じ扱い。失敗にせず queued のまま置く。
    expect(outcome.state).toBe('busy')
    expect(wan.submitted()).toHaveLength(0)
    const waiting = await f.jobs.findById(second)
    expect(waiting?.status).toBe('queued')
    expect(waiting?.providerJobRef).toBeNull()
    // 問い合わせの回数（約 3 時間で尽きる）を順番待ちに食わせない（ADR-0031 の理由）。
    expect(waiting?.attempt).toBe(before?.attempt)
    // やり直しは予約されている（取り残さない）。
    expect(f.scheduler.scheduled().map((s) => s.data.generationJobId)).toContain(second)
  })

  /**
   * **整理券**（制作者 2026-10-08「戦子ちゃん側止まってそうだな」）。
   *
   * 早い者勝ちだと、GPU が空いた瞬間に動いていたジョブが取る。
   * 2 作品を積んだ夜、**先に積んだほうが 5 時間 1 本も進まなかった**。
   * 空いていても、自分より先に積まれた生成が待っているなら取らない。
   */
  it('空いていても、先に積まれた生成が待っていれば投入しない', async () => {
    const vpipe = localProvider(VPIPE_MODEL)
    const wan = localProvider(WAN_MODEL)
    const f = await buildFixture({ providers: [vpipe, wan], models: [VPIPE_MODEL, WAN_MODEL] })

    const earlier = f.jobIdFor(VPIPE_MODEL)
    const later = f.jobIdFor(WAN_MODEL)

    /** 別の誰かが GPU を使っている間に、2 本とも列へ並ばせる。 */
    const other = '01ZZZZZZZZZZZZZZZZZZZZZZZZ' as GenerationJobId
    await f.deps.localGpuLease.acquire(other, 0)
    expect((await f.runFor(earlier)).state).toBe('busy')
    expect((await f.runFor(later)).state).toBe('busy')
    await f.deps.localGpuLease.release(other)

    // **GPU は空いた。** それでも順番は先に積んだほうにあるので、後ろは投入しない
    const outcome = await f.runFor(later)

    expect(outcome.state).toBe('busy')
    expect(wan.submitted()).toHaveLength(0)
    expect((await f.jobs.findById(later))?.status).toBe('queued')

    // 先に積んだほうには渡る
    expect((await f.runFor(earlier)).state).toBe('submitted')
    expect(vpipe.submitted()).toHaveLength(1)
  })

  /**
   * **後ろは頻繁に見ても取れない。** 取れるのは先頭だけなので、後ろは長く寝かせる。
   * 先頭だけ短く起こす（空いてから動き出すまでの遊びを減らす）。
   */
  it('先頭は短く、後ろは長く寝る', async () => {
    const f = await buildFixture({
      providers: [localProvider(VPIPE_MODEL), localProvider(WAN_MODEL), localProvider(THIRD_MODEL)],
      models: [VPIPE_MODEL, WAN_MODEL, THIRD_MODEL],
    })
    const running = f.jobIdFor(VPIPE_MODEL)
    const head = f.jobIdFor(WAN_MODEL)
    const behind = f.jobIdFor(THIRD_MODEL)

    // 1 本目が走り出し、2 本目（次の番）と 3 本目（その後ろ）が並ぶ
    expect((await f.runFor(running)).state).toBe('submitted')
    await f.runFor(head)
    await f.runFor(behind)

    const waits = new Map(
      f.scheduler.scheduled().map((entry) => [entry.data.generationJobId, entry.delayMs]),
    )
    // **次の番は短く起こす**（空いてから動き出すまでの遊びを減らす）
    expect(waits.get(head)).toBe(SUBMIT_BUSY_HEAD_MIN_DELAY_MS)
    // **その後ろは長く寝かせる**（どうせ取れないので叩く意味が無い）
    expect(waits.get(behind)).toBe(SUBMIT_BUSY_DEFAULT_DELAY_MS)
  })

  it('1 本目が終われば 2 本目が投入される', async () => {
    const vpipe = localProvider(VPIPE_MODEL, [{ state: 'failed', error: { code: 'x', message: 'だめ', retryable: false } }])
    const wan = localProvider(WAN_MODEL)
    const f = await buildFixture({ providers: [vpipe, wan], models: [VPIPE_MODEL, WAN_MODEL] })

    const first = f.jobIdFor(VPIPE_MODEL)
    const second = f.jobIdFor(WAN_MODEL)

    await f.runFor(first)
    expect((await f.runFor(second)).state).toBe('busy')

    // 1 本目が終わる（失敗でも GPU は空く）。
    expect((await f.runFor(first)).state).toBe('failed')

    expect((await f.runFor(second)).state).toBe('submitted')
    expect(wan.submitted()).toHaveLength(1)
  })

  /**
   * **成功で終わったときも順番を返す。** 失敗の経路は終端の処理が返すので、ここを確かめないと
   * 「成功したら押さえたまま」に気付けない（実際に、失敗の経路だけで試していて素通りした）。
   */
  it('1 本目が成功で終わっても 2 本目が投入される', async () => {
    const lease = createInMemoryLocalGpuLease()
    const vpipe = localProvider(VPIPE_MODEL, [SUCCEEDED])
    const wan = localProvider(WAN_MODEL)
    const f = await buildFixture({
      providers: [vpipe, wan],
      models: [VPIPE_MODEL, WAN_MODEL],
      lease,
    })

    const first = f.jobIdFor(VPIPE_MODEL)
    const second = f.jobIdFor(WAN_MODEL)

    await f.runFor(first)
    expect((await f.runFor(second)).state).toBe('busy')

    expect((await f.runFor(first)).state).toBe('succeeded')
    // 順番が空いていることを直に確かめる（2 本目が通るだけでは、順番を作っていなくても通る）。
    expect(await lease.acquire(JOB_A, 1_000)).toEqual({ state: 'acquired' })
    await lease.release(JOB_A)
    expect((await f.runFor(second)).state).toBe('submitted')
  })

  it('同じジョブの投入のやり直しは、自分の順番で自分を待たせない', async () => {
    const vpipe = localProvider(VPIPE_MODEL)
    const f = await buildFixture({ providers: [vpipe], models: [VPIPE_MODEL] })
    const job = f.jobIdFor(VPIPE_MODEL)

    expect((await f.runFor(job)).state).toBe('submitted')
    // 投入済みなので 2 回目は問い合わせになる。順番は自分が持ったまま。
    expect((await f.runFor(job)).state).toBe('polling')
  })

  /** 雲の上の Provider（fal）はこの機械の GPU を使わない。止める理由が無い。 */
  it('ローカルが作っている間も、クラウドの生成は止めない', async () => {
    const vpipe = localProvider(VPIPE_MODEL)
    const cloud = cloudProvider()
    const f = await buildFixture({
      providers: [vpipe, cloud],
      models: [VPIPE_MODEL, CLOUD_MODEL],
    })

    const local = f.jobIdFor(VPIPE_MODEL)
    const remote = f.jobIdFor(CLOUD_MODEL)

    expect((await f.runFor(local)).state).toBe('submitted')
    expect((await f.runFor(remote)).state).toBe('submitted')
    expect(cloud.submitted()).toHaveLength(1)
  })

  it('投入が満杯で断られたら、順番は離す（押さえたまま待たない）', async () => {
    const lease = createInMemoryLocalGpuLease()
    const busyProvider: VideoProvider = {
      ...createTestProvider([VPIPE_MODEL]),
      exclusiveResource: 'local-gpu',
      submit: () =>
        Promise.reject(new ProviderBusyError('満杯です', VPIPE_MODEL.providerId, null)),
    }
    const wan = localProvider(WAN_MODEL)
    const f = await buildFixture({
      providers: [busyProvider, wan],
      models: [VPIPE_MODEL, WAN_MODEL],
      lease,
    })

    const first = f.jobIdFor(VPIPE_MODEL)
    const second = f.jobIdFor(WAN_MODEL)

    expect((await f.runFor(first)).state).toBe('busy')

    // **順番が空いていることを直に確かめる。** 2 本目が通ることだけでは、
    // 順番を作っていなくても通ってしまい、何も確かめていないことになる。
    expect(await lease.acquire(JOB_A, 1_000)).toEqual({ state: 'acquired' })
    await lease.release(JOB_A)

    // 1 本目は何も投入していないので、2 本目は待たされない。
    expect((await f.runFor(second)).state).toBe('submitted')
  })

  it('取り消されたジョブは、次に見たときに順番を返す', async () => {
    const vpipe = localProvider(VPIPE_MODEL)
    const wan = localProvider(WAN_MODEL)
    const lease = createInMemoryLocalGpuLease()
    const f = await buildFixture({
      providers: [vpipe, wan],
      models: [VPIPE_MODEL, WAN_MODEL],
      lease,
    })

    const first = f.jobIdFor(VPIPE_MODEL)
    const second = f.jobIdFor(WAN_MODEL)
    await f.runFor(first)
    // 取り消す前は、2 本目は待っている（ここが通らないと以下が何も確かめていない）。
    expect((await f.runFor(second)).state).toBe('busy')

    // API が行を取り消しにする（生成先には API が止めてと頼む）。
    await f.jobs.update(first, { status: 'cancelled' })
    expect((await f.runFor(first)).state).toBe('skipped')

    expect((await f.runFor(second)).state).toBe('submitted')
  })
})

const JOB_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as GenerationJobId
const JOB_B = '01BX5ZZKBKACTAV9WEVGEMMVRZ' as GenerationJobId
const JOB_C = '01CX5ZZKBKACTAV9WEVGEMMVRZ' as GenerationJobId

describe('借りそのもの', () => {
  /** 券の番号。小さいほど先に積まれた。 */
  const EARLY = 1_000
  const LATE = 2_000

  it('空いていれば借りられ、ほかのジョブには貸さない', async () => {
    const lease = createInMemoryLocalGpuLease()
    expect(await lease.acquire(JOB_A, EARLY)).toEqual({ state: 'acquired' })
    expect(await lease.acquire(JOB_B, LATE)).toEqual({ state: 'held', by: JOB_A, ahead: 0 })
    // 同じジョブは何度でも借りられる（冪等）。
    expect(await lease.acquire(JOB_A, EARLY)).toEqual({ state: 'acquired' })
  })

  it('返すのは自分の借りだけ', async () => {
    const lease = createInMemoryLocalGpuLease()
    await lease.acquire(JOB_A, EARLY)
    await lease.release(JOB_B)
    expect(await lease.acquire(JOB_B, LATE)).toEqual({ state: 'held', by: JOB_A, ahead: 0 })
    await lease.release(JOB_A)
    expect(await lease.acquire(JOB_B, LATE)).toEqual({ state: 'acquired' })
  })

  /**
   * **整理券の肝**（制作者 2026-10-08「戦子ちゃん側止まってそうだな」）。
   *
   * 早い者勝ちだと、空いた瞬間に起きていたジョブが取る。列の長い作品が勝ち続け、
   * もう片方は何時間も進まない（実際に 5 時間 0 本）。**先に積んだほうから渡す。**
   */
  it('後から積んだジョブが先に頼んでも、先に積んだほうが取る', async () => {
    const lease = createInMemoryLocalGpuLease()

    // 後から積んだ B が先に並ぶ。A はまだ来ていないので B が先頭
    expect(await lease.acquire(JOB_B, LATE)).toEqual({ state: 'acquired' })
    await lease.release(JOB_B)

    // A（先に積んだ）が並んだあとは、B が先に頼んでも A に渡る
    expect(await lease.acquire(JOB_A, EARLY)).toEqual({ state: 'acquired' })
    await lease.release(JOB_A)
    await lease.acquire(JOB_B, LATE)
    await lease.release(JOB_B)

    // 2 本が同時に待っている状態を作る: C(遅い) が並んでから A(早い) が来る
    const lease2 = createInMemoryLocalGpuLease()
    await lease2.acquire(JOB_C, LATE)
    await lease2.release(JOB_C)
    // いったん両方を列に入れる（取れないよう、先に別のジョブへ貸しておく）
    await lease2.acquire(JOB_B, 500)
    expect(await lease2.acquire(JOB_C, LATE)).toEqual({ state: 'held', by: JOB_B, ahead: 0 })
    expect(await lease2.acquire(JOB_A, EARLY)).toEqual({ state: 'held', by: JOB_B, ahead: 0 })
    await lease2.release(JOB_B)

    // 空いた。**後から頼んだ C ではなく、先に積んだ A に渡る**
    expect(await lease2.acquire(JOB_C, LATE)).toEqual({ state: 'waiting', ahead: 1 })
    expect(await lease2.acquire(JOB_A, EARLY)).toEqual({ state: 'acquired' })
  })

  /**
   * 同じミリ秒に積まれた分（まとめて積むと実際に起きる）は、**jobId の順**で割る。
   * ULID は時系列なので積んだ順になり、**何度やっても同じ順**。
   */
  it('券の番号が同じなら jobId の小さいほうが先', async () => {
    const lease = createInMemoryLocalGpuLease()
    await lease.acquire(JOB_C, 100)
    await lease.release(JOB_C)
    await lease.acquire(JOB_C, 100)

    expect(await lease.acquire(JOB_B, 500)).toEqual({ state: 'held', by: JOB_C, ahead: 0 })
    expect(await lease.acquire(JOB_A, 500)).toEqual({ state: 'held', by: JOB_C, ahead: 0 })
    await lease.release(JOB_C)

    // A と B は同じ番号。**id の小さいほう（= 先に作られた ULID）が先**
    expect(JOB_A < JOB_B).toBe(true)
    expect(await lease.acquire(JOB_B, 500)).toEqual({ state: 'waiting', ahead: 1 })
    expect(await lease.acquire(JOB_A, 500)).toEqual({ state: 'acquired' })
  })

  /**
   * **死んだ券で列を止めない。** worker が落ちたジョブは顔を出さなくなる。
   * 捨てないと、先頭に居座って後ろが永久に進まない。
   */
  it('顔を出さなくなった券は捨てて、列を進める', async () => {
    let nowMs = 1_000_000
    const lease = createInMemoryLocalGpuLease({ now: () => new Date(nowMs) })

    // A（先に積んだ）が並び、そのまま消える
    expect(await lease.acquire(JOB_A, EARLY)).toEqual({ state: 'acquired' })
    await lease.release(JOB_A)
    await lease.acquire(JOB_C, 500)
    await lease.acquire(JOB_A, EARLY)
    expect(await lease.acquire(JOB_B, LATE)).toEqual({ state: 'held', by: JOB_C, ahead: 1 })
    await lease.release(JOB_C)

    // A が居る間は B に渡らない
    expect(await lease.acquire(JOB_B, LATE)).toEqual({ state: 'waiting', ahead: 1 })

    // A が顔を出さないまま時間が過ぎると、券が捨てられて B の番になる
    nowMs += LOCAL_GPU_LINE_STALE_MS + 1
    expect(await lease.acquire(JOB_B, LATE)).toEqual({ state: 'acquired' })
  })

  /** 期限は問い合わせの間隔（手元のサーバは 30 秒おき）より十分長いこと。 */
  it('期限は問い合わせを数回落としても保つ長さ', () => {
    expect(LOCAL_GPU_LEASE_TTL_MS).toBeGreaterThanOrEqual(30_000 * 5)
  })

  /**
   * 配線を忘れたら黙って通さず、通したことを残す（LESSONS「飛ばした検査は痕跡を残す」）。
   */
  it('配線されていない借りは、順番を作っていないことをログに残す', async () => {
    const logger = createCapturingLogger()
    const lease = createUnprotectedLocalGpuLease(logger.logger)
    expect(await lease.acquire(JOB_A, 1_000)).toEqual({ state: 'acquired' })
    expect(await lease.acquire(JOB_B, 2_000)).toEqual({ state: 'acquired' })
    expect(logger.lines().some((line) => line.msg.includes('同時に走る'))).toBe(true)
  })
})
