import { GenerationJob, newId, GenerationJobId, type Project } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { baseAppDeps } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { CHEAP_MODEL, postJson, type ErrorBody, type Ok } from './shot-test-support.js'
import { createTestVideoProvider } from './test-video-provider.js'

/**
 * 生成をやめる（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい」）。
 *
 * 生成先には止める口がある（`VideoProvider.cancel`）が、API と画面に口が無かった。
 * **やめたことは生成先に届かなくても確定する。** 届かなかったことはログに残す。
 */

type CancelData = {
  cancelledJobIds: string[]
  shot: { id: string; status: string }
}

const SPEC_HASH = 'a'.repeat(64)

const aJob = (
  shotId: GenerationJob['shotId'],
  overrides: Partial<GenerationJob> = {},
): GenerationJob =>
  GenerationJob.parse({
    id: newId(GenerationJobId),
    shotId,
    specHash: SPEC_HASH,
    requestedModel: CHEAP_MODEL.id,
    resolvedModel: CHEAP_MODEL.id,
    routerDecision: null,
    status: 'running',
    attempt: 1,
    providerJobRef: 'provider-job-1',
    error: null,
    parentTakeId: null,
    regenerationReason: null,
    corrections: [],
    seed: null,
    queuedAt: new Date('2026-10-01T00:00:00.000Z'),
    startedAt: new Date('2026-10-01T00:00:05.000Z'),
    providerStartedAt: null,
    finishedAt: null,
    ...overrides,
  })

const build = (
  options: {
    readonly project?: Project
    readonly jobs?: (shotId: GenerationJob['shotId']) => readonly GenerationJob[]
    readonly withTake?: boolean
    readonly cancelError?: Error
  } = {},
) => {
  const project = options.project ?? aProject()
  const shot = aShot(project.id, { status: 'generating' })
  const shots = createInMemoryShotRepository([shot])
  const takes = createInMemoryTakeRepository(options.withTake === true ? [aTake(shot, SPEC_HASH)] : [])
  const generationJobs = createInMemoryGenerationJobRepository(options.jobs?.(shot.id) ?? [])
  const provider = createTestVideoProvider(
    [CHEAP_MODEL],
    options.cancelError === undefined ? {} : { cancelError: options.cancelError },
  )
  const events = createInMemoryProjectEvents()
  const app = createApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository([project]),
    shots,
    takes,
    generationJobs,
    registry: createProviderRegistry([provider]),
    events,
  })
  return { app, shot, shots, generationJobs, provider, events }
}

const cancel = (f: ReturnType<typeof build>) =>
  postJson(f.app, `/shots/${f.shot.id}/generations/cancel`, {})

describe('POST /shots/:id/generations/cancel', () => {
  it('動いている生成（順番待ち・作成中）をすべて取り消す', async () => {
    const f = build({
      jobs: (shotId) => [
        aJob(shotId, { status: 'running', providerJobRef: 'ref-running' }),
        aJob(shotId, { status: 'queued', providerJobRef: null, startedAt: null }),
      ],
    })

    const res = await cancel(f)

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<CancelData>
    expect(json.data.cancelledJobIds).toHaveLength(2)
    expect(f.generationJobs.snapshot().map((job) => job.status)).toEqual(['cancelled', 'cancelled'])
    expect(f.generationJobs.snapshot().every((job) => job.finishedAt !== null)).toBe(true)
  })

  it('終わった生成には触らない', async () => {
    const f = build({
      jobs: (shotId) => [
        aJob(shotId, { status: 'succeeded', finishedAt: new Date() }),
        aJob(shotId, { status: 'running', providerJobRef: 'ref-running' }),
      ],
    })

    const json = (await (await cancel(f)).json()) as Ok<CancelData>

    expect(json.data.cancelledJobIds).toHaveLength(1)
    expect(f.generationJobs.snapshot().map((job) => job.status)).toEqual(['succeeded', 'cancelled'])
  })

  it('生成先へ送ったものだけ、生成先にも止めてと頼む', async () => {
    const f = build({
      jobs: (shotId) => [
        aJob(shotId, { status: 'running', providerJobRef: 'ref-running' }),
        aJob(shotId, { status: 'queued', providerJobRef: null, startedAt: null }),
      ],
    })

    await cancel(f)

    expect(f.provider.cancelled()).toEqual(['ref-running'])
  })

  it('生成先に届かなくても、取り消しは確定する', async () => {
    const f = build({
      jobs: (shotId) => [aJob(shotId, { status: 'running', providerJobRef: 'ref-running' })],
      cancelError: new Error('生成先に届きません'),
    })

    const res = await cancel(f)

    expect(res.status).toBe(200)
    expect(f.generationJobs.snapshot()[0]?.status).toBe('cancelled')
  })

  it('Take が無ければ Shot を下書きに戻す（要判断にしない）', async () => {
    const f = build({ jobs: (shotId) => [aJob(shotId)] })

    const json = (await (await cancel(f)).json()) as Ok<CancelData>

    expect(json.data.shot.status).toBe('draft')
    expect(f.shots.snapshot()[0]?.status).toBe('draft')
  })

  it('Take があれば採用待ちに戻す', async () => {
    const f = build({ jobs: (shotId) => [aJob(shotId)], withTake: true })

    const json = (await (await cancel(f)).json()) as Ok<CancelData>

    expect(json.data.shot.status).toBe('review')
  })

  it('取り消したことを画面へ流す（ジョブごとと、Shot の状態）', async () => {
    const f = build({ jobs: (shotId) => [aJob(shotId)] })

    await cancel(f)

    const types = f.events.published().map((event) =>
      event.type === 'generation_job.status' ? `job:${event.status}` : event.type === 'shot.status' ? `shot:${event.status}` : event.type,
    )
    expect(types).toEqual(['job:cancelled', 'shot:draft'])
  })

  it('動いている生成が無ければ何もせず、空で返す', async () => {
    const f = build({ jobs: (shotId) => [aJob(shotId, { status: 'failed', finishedAt: new Date() })] })

    const res = await cancel(f)

    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<CancelData>
    expect(json.data.cancelledJobIds).toEqual([])
    // 生成中でない Shot の状態は変えない
    expect(f.events.published()).toEqual([])
  })

  it('存在しない Shot は 404', async () => {
    const f = build()
    const res = await postJson(f.app, `/shots/${aShot(aProject().id).id}/generations/cancel`, {})
    expect(res.status).toBe(404)
    expect(((await res.json()) as ErrorBody).success).toBe(false)
  })
})
