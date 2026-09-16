import {
  TakeId as TakeIdSchema,
  newId,
  type ReviewFinding,
  type ReviewRunId,
  type Shot,
  type Take,
  type Verdict,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  type InMemoryShotRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import {
  processRegenerationJob,
  type RegenerationProcessorDeps,
} from '../processor.js'
import {
  aFinding,
  aProject,
  aReviewRun,
  inMemoryProjects,
  inMemoryReviews,
  recordingQueue,
  silentLogger,
  type RecordingQueue,
} from './doubles.js'

const SPEC_HASH = 'a'.repeat(64)

type HarnessOptions = {
  /** 対象 Shot の Take のコスト。要素数がそのまま attempts になる。 */
  readonly takeCosts?: readonly number[]
  /** 対象 Shot 以外で使ったコスト。プロジェクト予算の判定にだけ効く。 */
  readonly otherShotCosts?: readonly number[]
  readonly budgetUsd?: number | null
  readonly verdict?: Verdict | null
  /** 既定は identity の fail 指摘 1 件（自動再生成の対象）。 */
  readonly findings?: (runId: ReviewRunId) => readonly ReviewFinding[]
  /** ReviewRun を作らない。 */
  readonly withoutRun?: boolean
  readonly enqueueFails?: Error
}

type Harness = {
  readonly deps: RegenerationProcessorDeps
  readonly shot: Shot
  readonly take: Take
  readonly shots: InMemoryShotRepository
  readonly queue: RecordingQueue
}

const harness = (options: HarnessOptions = {}): Harness => {
  const {
    takeCosts = [0.4],
    otherShotCosts = [],
    budgetUsd = null,
    verdict = 'fail',
    findings = (runId) => [aFinding(runId, 'identity', 'fail')],
    withoutRun = false,
    enqueueFails,
  } = options

  const project = aProject({ budgetUsd })
  const shot = aShot(project.id, { status: 'review' })
  const otherShot = aShot(project.id, { code: 'shot_002', order: 2000 })

  const takes: readonly Take[] = [
    ...takeCosts.map((costUsd, i) => aTake(shot, SPEC_HASH, { index: i + 1, costUsd })),
    ...otherShotCosts.map((costUsd, i) => aTake(otherShot, SPEC_HASH, { index: i + 1, costUsd })),
  ]

  // 判定の対象は「いま fail した Take」＝対象 Shot の最後の Take。
  const take = takes[takeCosts.length - 1]
  if (take === undefined) throw new Error('takeCosts は 1 件以上必要です')

  const run = aReviewRun(take.id, { verdict })
  const queue = recordingQueue(enqueueFails)
  const shots = createInMemoryShotRepository([shot, otherShot])

  return {
    shot,
    take,
    shots,
    queue,
    deps: {
      takes: createInMemoryTakeRepository(takes),
      shots,
      projects: inMemoryProjects([project]),
      reviews: withoutRun
        ? inMemoryReviews([], [])
        : inMemoryReviews([run], [...findings(run.id)]),
      queue,
      logger: silentLogger,
    },
  }
}

const statusOf = (h: Harness): string =>
  h.shots.snapshot().find((s) => s.id === h.shot.id)?.status ?? 'missing'

describe('processRegenerationJob', () => {
  it('fail した Take を再生成としてキューへ積む', async () => {
    const h = harness()

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state).toBe('queued')
    expect(h.queue.requests()).toHaveLength(1)
    expect(h.queue.requests()[0]?.parentTakeId).toBe(h.take.id)
    expect(h.queue.requests()[0]?.shotId).toBe(h.shot.id)
    expect(h.queue.requests()[0]?.adjustment.actions.map((a) => a.kind)).toContain(
      'raise_reference_priority',
    )
    // 止めていないのだから Shot の状態は変えない。
    expect(statusOf(h)).toBe('review')
  })

  it('積んだ要求の理由が Take の regenerationReason になる形で入っている', async () => {
    const h = harness()

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state === 'queued' && outcome.reason.length > 0).toBe(true)
    expect(h.queue.requests()[0]?.reason).toBe(
      outcome.state === 'queued' ? outcome.reason : undefined,
    )
  })

  /* --- 上限。4 つすべてで止まることを示す --- */

  it('回数の上限に達したら blocked にして積まない', async () => {
    // 既定の maxAttemptsPerShot は 3。Take が 3 本ある時点で打ち止め。
    const h = harness({ takeCosts: [0.1, 0.1, 0.1] })

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state).toBe('blocked')
    expect(outcome.reason).toContain('再生成の上限')
    expect(h.queue.requests()).toHaveLength(0)
    expect(statusOf(h)).toBe('blocked')
  })

  it('Shot のコスト上限に達したら blocked にして積まない', async () => {
    // 既定の maxCostPerShotUsd は $2。1 本で使い切った状態。
    const h = harness({ takeCosts: [2] })

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state).toBe('blocked')
    expect(outcome.reason).toContain('Shot あたりのコスト上限')
    expect(h.queue.requests()).toHaveLength(0)
    expect(statusOf(h)).toBe('blocked')
  })

  it('プロジェクトの予算に達したら blocked にして積まない', async () => {
    // Shot 単体では上限内でも、プロジェクト全体で予算 $1 を超えている。
    const h = harness({ takeCosts: [0.5], otherShotCosts: [0.6], budgetUsd: 1 })

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state).toBe('blocked')
    expect(outcome.reason).toContain('プロジェクトの予算')
    expect(h.queue.requests()).toHaveLength(0)
    expect(statusOf(h)).toBe('blocked')
  })

  it('人間の判断が必要な回数に達したら blocked にして積まない', async () => {
    // 既定の requireHumanApprovalAfter は 2。回数・コストの上限より先に効く。
    const h = harness({ takeCosts: [0.1, 0.1] })

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state).toBe('blocked')
    expect(outcome.reason).toContain('人間の判断が必要')
    expect(h.queue.requests()).toHaveLength(0)
    expect(statusOf(h)).toBe('blocked')
  })

  it('autoRegenerateOn に無いレビュアの fail では積まず、人間に渡す', async () => {
    const h = harness({
      findings: (runId) => [aFinding(runId, 'continuity', 'fail')],
    })

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state).toBe('blocked')
    expect(outcome.reason).toContain('continuity')
    expect(h.queue.requests()).toHaveLength(0)
    expect(statusOf(h)).toBe('blocked')
  })

  it('Project の budgetUsd がそのままプロジェクト上限になる', async () => {
    // budgetUsd $5 に対し、プロジェクト全体で $5 使い切った状態。
    const h = harness({ takeCosts: [1], otherShotCosts: [4], budgetUsd: 5 })

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome.state).toBe('blocked')
    expect(outcome.reason).toContain('$5')
  })

  /* --- 対象外 --- */

  it.each<Verdict | null>(['pass', 'warn', null])(
    'verdict が %s なら何もしない',
    async (verdict) => {
      const h = harness({ verdict })

      const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

      expect(outcome.state).toBe('skipped')
      expect(h.queue.requests()).toHaveLength(0)
      expect(statusOf(h)).toBe('review')
    },
  )

  it('ReviewRun がまだ無ければ何もしない', async () => {
    const h = harness({ withoutRun: true })

    const outcome = await processRegenerationJob(h.deps, { takeId: h.take.id })

    expect(outcome).toEqual({ state: 'skipped', reason: 'no_review_run' })
    expect(h.queue.requests()).toHaveLength(0)
  })

  /* --- 入力の異常 --- */

  it('Take が見つからなければ throw する', async () => {
    const h = harness()

    await expect(
      processRegenerationJob(h.deps, { takeId: newId(TakeIdSchema) }),
    ).rejects.toThrow('Take が見つかりません')
  })

  it('ジョブデータが不正なら zod で弾く', async () => {
    const h = harness()

    await expect(processRegenerationJob(h.deps, { takeId: 'not-a-ulid' })).rejects.toThrow()
    await expect(processRegenerationJob(h.deps, {})).rejects.toThrow()
  })

  it('キューへ積めなければ握り潰さず throw する（再試行に任せる）', async () => {
    const h = harness({ enqueueFails: new Error('redis down') })

    await expect(processRegenerationJob(h.deps, { takeId: h.take.id })).rejects.toThrow('redis down')
    // 積めなかっただけで人間の判断待ちにはしない。
    expect(statusOf(h)).toBe('review')
  })
})
