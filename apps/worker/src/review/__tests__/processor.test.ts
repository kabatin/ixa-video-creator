import { newId, TakeId as TakeIdSchema, type CreateReviewFindingInput } from '@ixa/domain'
import type { DeterministicReviewer } from '@ixa/review'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import type { TakeMeasurer } from '../measure.js'
import { processReviewJob, type ReviewProcessorDeps } from '../processor.js'
import {
  aProject,
  aReviewRun,
  aShot,
  aTake,
  aVideoAsset,
  fakeRegenerationQueue,
  fakeVisionReviewer,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryReviews,
  inMemoryShots,
  inMemoryTakes,
  measurements,
  noMusicAnalysis,
  silentLogger,
  visionResult,
  type FakeRegenerationQueue,
  type FakeVisionReviewer,
  type InMemoryReviews,
  type InMemoryTakes,
} from './doubles.js'

/**
 * ADR-0005 の要は「決定的チェックが fail したら LLM 層を実行しない」こと。
 * vision レビュアが 1 度も呼ばれないことを、呼び出し記録で検証する。
 */

const finding = (overrides: Partial<CreateReviewFindingInput> = {}): CreateReviewFindingInput => ({
  reviewer: 'technical',
  severity: 'fail',
  score: 0,
  message: '尺が仕様と一致しません',
  evidence: null,
  suggestedPromptDelta: null,
  ...overrides,
})

/** 指定した指摘を必ず返す決定的レビュア。 */
const reviewerReturning = (
  findings: readonly CreateReviewFindingInput[],
): DeterministicReviewer => () => findings

type Harness = {
  readonly deps: ReviewProcessorDeps
  readonly takeId: ReturnType<typeof aTake>['id']
  readonly takes: InMemoryTakes
  readonly reviews: InMemoryReviews
  readonly vision: FakeVisionReviewer
  readonly regeneration: FakeRegenerationQueue
}

type HarnessOptions = {
  readonly deterministic?: readonly DeterministicReviewer[]
  readonly vision?: FakeVisionReviewer
  readonly visionReviewers?: readonly FakeVisionReviewer[]
  readonly measurer?: TakeMeasurer
  readonly seedRuns?: 'completed' | 'none'
  readonly regeneration?: FakeRegenerationQueue
  /** false にすると MediaAsset を登録しない。 */
  readonly withAsset?: boolean
}

const harness = (options: HarnessOptions = {}): Harness => {
  const project = aProject()
  const shot = aShot(project)
  const asset = aVideoAsset(project)
  const take = aTake(shot, asset.id)

  const takes = inMemoryTakes([take])
  const vision = options.vision ?? fakeVisionReviewer()
  const regeneration = options.regeneration ?? fakeRegenerationQueue()
  const reviews = inMemoryReviews(
    options.seedRuns === 'completed' ? [aReviewRun(take.id, { status: 'done' })] : [],
  )

  const deps: ReviewProcessorDeps = {
    takes,
    shots: inMemoryShots([shot]),
    projects: inMemoryProjects([project]),
    mediaAssets: inMemoryMediaAssets(options.withAsset === false ? [] : [asset]),
    musicAnalyses: noMusicAnalysis(),
    reviews,
    storage: createMemoryStorage(),
    regenerationQueue: regeneration,
    deterministicReviewers: options.deterministic ?? [reviewerReturning([])],
    visionReviewers: options.visionReviewers ?? [vision],
    workDir: '/unused-because-the-measurer-is-injected',
    logger: silentLogger,
    measurer: options.measurer ?? (() => Promise.resolve(measurements(take, shot))),
  }

  return { deps, takeId: take.id, takes, reviews, vision, regeneration }
}

describe('processReviewJob', () => {
  it('ジョブデータを zod で検証する', async () => {
    const { deps } = harness()
    await expect(processReviewJob(deps, { takeId: 'not-a-ulid' })).rejects.toThrow()
    await expect(processReviewJob(deps, {})).rejects.toThrow()
  })

  it('Take が見つからなければ throw する（再試行しても直らない）', async () => {
    const { deps } = harness()
    await expect(
      processReviewJob(deps, { takeId: newId(TakeIdSchema) }),
    ).rejects.toThrow(/Take が見つかりません/)
  })

  it('MediaAsset が見つからなければ throw する', async () => {
    const { deps, takeId } = harness({ withAsset: false })
    await expect(processReviewJob(deps, { takeId })).rejects.toThrow(/MediaAsset が見つかりません/)
  })

  describe('Stage 1 が fail したとき', () => {
    it('vision レビュアを 1 度も呼ばない（ADR-0005）', async () => {
      const { deps, takeId, vision } = harness({
        deterministic: [reviewerReturning([finding()])],
      })

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'reviewed', verdict: 'fail' })
      expect(vision.calls()).toHaveLength(0)
    })

    it('複数の vision レビュアを登録していても 1 つも呼ばない', async () => {
      const identity = fakeVisionReviewer({ name: 'identity', supports: ['identity'] })
      const continuity = fakeVisionReviewer({ name: 'continuity', supports: ['continuity'] })
      const { deps, takeId } = harness({
        deterministic: [reviewerReturning([finding()])],
        visionReviewers: [identity, continuity],
      })

      await processReviewJob(deps, { takeId })

      expect(identity.calls()).toHaveLength(0)
      expect(continuity.calls()).toHaveLength(0)
    })

    it('ReviewRun を fail で確定し、コストは 0 のままにする', async () => {
      const { deps, takeId, reviews } = harness({
        deterministic: [reviewerReturning([finding()])],
      })

      await processReviewJob(deps, { takeId })

      const run = reviews.runs()[0]
      expect(run?.status).toBe('done')
      expect(run?.verdict).toBe('fail')
      expect(run?.costUsd).toBe(0)
    })

    it('Take の reviewStatus を failed にする', async () => {
      const { deps, takeId, takes } = harness({
        deterministic: [reviewerReturning([finding()])],
      })

      await processReviewJob(deps, { takeId })

      expect(takes.reviewStatusOf(takeId)).toBe('failed')
    })

    it('warn どまりなら vision レビュアを呼ぶ', async () => {
      const { deps, takeId, vision } = harness({
        deterministic: [reviewerReturning([finding({ severity: 'warn' })])],
      })

      await processReviewJob(deps, { takeId })

      expect(vision.calls()).toHaveLength(1)
    })
  })

  describe('Stage 1 が通ったとき', () => {
    it('vision の指摘を追記し、verdict と reviewStatus を揃える', async () => {
      const { deps, takeId, takes, reviews } = harness()

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'reviewed', verdict: 'warn' })
      expect(reviews.findings()).toHaveLength(1)
      expect(reviews.findings()[0]?.reviewer).toBe('identity')
      expect(takes.reviewStatusOf(takeId)).toBe('warned')
    })

    it('指摘が無ければ pass にする', async () => {
      const vision = fakeVisionReviewer({
        result: visionResult({ severity: 'info', score: 1, suggestedPromptDelta: null }),
      })
      const { deps, takeId, takes } = harness({ vision })

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'reviewed', verdict: 'pass' })
      expect(takes.reviewStatusOf(takeId)).toBe('passed')
    })

    it('vision の実コストを ReviewRun に記録する', async () => {
      const vision = fakeVisionReviewer({ costUsd: 0.07 })
      const { deps, takeId, reviews } = harness({ vision })

      await processReviewJob(deps, { takeId })

      expect(reviews.runs()[0]?.costUsd).toBeCloseTo(0.07)
    })

    it('LLM が返した負の frameSec は捨てる（保存できない値を通さない）', async () => {
      const vision = fakeVisionReviewer({ result: visionResult({ frameSec: -1 }) })
      const { deps, takeId, reviews } = harness({ vision })

      await processReviewJob(deps, { takeId })

      expect(reviews.findings()[0]?.evidence?.frameSec).toBeNull()
    })
  })

  describe('スキップ', () => {
    it('完了済みの ReviewRun があれば何もしない', async () => {
      const { deps, takeId, vision } = harness({ seedRuns: 'completed' })

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'skipped', reason: 'already_reviewed' })
      expect(vision.calls()).toHaveLength(0)
    })

    it('レビュアが 1 つも無ければ ReviewRun を作らない', async () => {
      const { deps, takeId, reviews } = harness({ deterministic: [], visionReviewers: [] })

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'skipped', reason: 'no_reviewers' })
      expect(reviews.runs()).toHaveLength(0)
    })
  })

  describe('失敗', () => {
    it('測定に失敗したら failed を返し、ReviewRun を failed で閉じる', async () => {
      const { deps, takeId, reviews, takes } = harness({
        measurer: () => Promise.reject(new Error('ffprobe が落ちました')),
      })

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'failed', code: 'Error' })
      expect(reviews.runs()[0]?.status).toBe('failed')
      expect(reviews.runs()[0]?.verdict).toBeNull()
      // 判定が出ていないので Take は触らない。
      expect(takes.reviewStatusOf(takeId)).toBeNull()
    })

    it('vision が落ちても、そこまでに払ったコストを ReviewRun に残す', async () => {
      const ok = fakeVisionReviewer({ name: 'ok', supports: ['identity'], costUsd: 0.05 })
      const broken = fakeVisionReviewer({
        name: 'broken',
        supports: ['continuity'],
        fail: new Error('LLM がタイムアウトしました'),
      })
      const { deps, takeId, reviews } = harness({ visionReviewers: [ok, broken] })

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'failed', code: 'vision_review_failed' })
      expect(reviews.runs()[0]?.status).toBe('failed')
      expect(reviews.runs()[0]?.costUsd).toBeCloseTo(0.05)
    })
  })

  describe('再生成キューへの投入', () => {
    it('verdict が fail なら takeId を積む', async () => {
      const { deps, takeId, regeneration } = harness({
        deterministic: [reviewerReturning([finding()])],
      })

      await processReviewJob(deps, { takeId })

      expect(regeneration.enqueued()).toEqual([takeId])
    })

    it('warn では積まない（人が見る）', async () => {
      const { deps, takeId, regeneration } = harness()

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'reviewed', verdict: 'warn' })
      expect(regeneration.enqueued()).toHaveLength(0)
    })

    it('pass では積まない', async () => {
      const vision = fakeVisionReviewer({ result: visionResult({ severity: 'info', score: 1 }) })
      const { deps, takeId, regeneration } = harness({ vision })

      await processReviewJob(deps, { takeId })

      expect(regeneration.enqueued()).toHaveLength(0)
    })

    it('レビューが失敗したときは積まない（判定が出ていない）', async () => {
      const { deps, takeId, regeneration } = harness({
        measurer: () => Promise.reject(new Error('ffprobe が落ちました')),
      })

      await processReviewJob(deps, { takeId })

      expect(regeneration.enqueued()).toHaveLength(0)
    })

    it('積めなくてもレビュー自体は成功のままにする', async () => {
      const { deps, takeId, reviews } = harness({
        deterministic: [reviewerReturning([finding()])],
        regeneration: fakeRegenerationQueue(new Error('Redis に繋がりません')),
      })

      const outcome = await processReviewJob(deps, { takeId })

      expect(outcome).toEqual({ state: 'reviewed', verdict: 'fail' })
      expect(reviews.runs()[0]?.status).toBe('done')
    })
  })

  it('依頼したレビュアの種別を ReviewRun に記録する', async () => {
    const vision = fakeVisionReviewer({ supports: ['identity', 'composition'] })
    const { deps, takeId, reviews } = harness({ vision })

    await processReviewJob(deps, { takeId })

    expect(reviews.runs()[0]?.reviewers).toEqual([
      'technical',
      'music',
      'brand',
      'identity',
      'composition',
    ])
  })
})
