import {
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  ReviewFinding as ReviewFindingSchema,
  ReviewFindingId as ReviewFindingIdSchema,
  ReviewRun as ReviewRunSchema,
  ReviewRunId as ReviewRunIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type Project,
  type ReviewFinding,
  type ReviewRun,
  type ReviewRunId,
  type ReviewerType,
  type Severity,
  type TakeId,
} from '@ixa/domain'
import pino from 'pino'
import type { RegenerationProcessorDeps, RegenerationRequest } from '../processor.js'

/**
 * 再生成プロセッサのテストダブル。実 DB・実 Redis には接続しない。
 * `apps/worker/src/analysis/__tests__/doubles.ts` と同じ作りにしてある。
 */

export const silentLogger = pino({ level: 'silent' })

export const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')

/* --- Project --- */

export const aProject = (overrides: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id: newId(ProjectIdSchema),
    workspaceId: newId(WorkspaceIdSchema),
    name: 'iXA CUP MUSIC VIDEO',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    durationSec: 116,
    budgetUsd: null,
    styleGuide: '',
    status: 'production',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  })

export type InMemoryProjects = RegenerationProcessorDeps['projects']

export const inMemoryProjects = (seed: readonly Project[] = []): InMemoryProjects => ({
  findById: (id) => Promise.resolve(seed.find((p) => p.id === id) ?? null),
})

/* --- Review --- */

export const aReviewRun = (takeId: TakeId, overrides: Partial<ReviewRun> = {}): ReviewRun =>
  ReviewRunSchema.parse({
    id: newId(ReviewRunIdSchema),
    takeId,
    reviewers: ['technical', 'identity'],
    status: 'done',
    verdict: 'fail',
    costUsd: 0.02,
    createdAt: CREATED_AT,
    ...overrides,
  })

export const aFinding = (
  reviewRunId: ReviewRunId,
  reviewer: ReviewerType,
  severity: Severity,
  overrides: Partial<ReviewFinding> = {},
): ReviewFinding =>
  ReviewFindingSchema.parse({
    id: newId(ReviewFindingIdSchema),
    reviewRunId,
    reviewer,
    severity,
    score: null,
    message: `${reviewer} の指摘`,
    evidence: null,
    suggestedPromptDelta: null,
    ...overrides,
  })

export type InMemoryReviews = RegenerationProcessorDeps['reviews']

/**
 * 判定は追記のみなので、読み取りの口しか持たせない。
 * ReviewRun は ULID 降順で「最新」を決める（本物のリポジトリと同じ）。
 */
export const inMemoryReviews = (
  runs: readonly ReviewRun[] = [],
  findings: readonly ReviewFinding[] = [],
): InMemoryReviews => ({
  findLatestRunByTake: (takeId) =>
    Promise.resolve(
      [...runs]
        .filter((r) => r.takeId === takeId)
        .sort((a, b) => (a.id < b.id ? 1 : -1))[0] ?? null,
    ),
  findFindingsByRun: (runId) =>
    Promise.resolve(findings.filter((f) => f.reviewRunId === runId)),
})

/* --- 生成キュー --- */

export type RecordingQueue = RegenerationProcessorDeps['queue'] & {
  /** 積まれた要求。1 件も積まれていなければ空配列。 */
  readonly requests: () => readonly RegenerationRequest[]
}

export const recordingQueue = (fail?: Error): RecordingQueue => {
  let requests: readonly RegenerationRequest[] = []
  return {
    requests: () => requests,
    enqueue: (request) => {
      if (fail !== undefined) return Promise.reject(fail)
      requests = [...requests, request]
      return Promise.resolve()
    },
  }
}
