import { describe, expect, it } from 'vitest'
import {
  CreateReviewFindingInput,
  CreateReviewRunInput,
  MediaAssetId,
  ReviewFindingId,
  ReviewRunId,
  TakeId,
  newId,
} from '@ixa/domain'
import type {
  ReviewFindingRow,
  ReviewRunRow,
} from '../repositories/review-repository.js'
import {
  reviewFindingRowToDomain,
  reviewRunRowToDomain,
} from '../repositories/review-repository.js'

/** 実 DB には接続しない。row → Domain の変換だけを確かめる。 */

const baseRunRow = (): ReviewRunRow => ({
  id: newId(ReviewRunId),
  takeId: newId(TakeId),
  reviewers: ['technical', 'music', 'identity'],
  status: 'done',
  verdict: 'warn',
  costUsd: 0.012,
  createdAt: new Date('2026-09-16T00:00:00Z'),
})

const baseFindingRow = (): ReviewFindingRow => ({
  id: newId(ReviewFindingId),
  reviewRunId: newId(ReviewRunId),
  reviewer: 'identity',
  severity: 'warn',
  score: 0.72,
  message: '参照画像との顔の一致度が低い',
  evidence: { frameSec: 1.5, bbox: [0.1, 0.2, 0.3, 0.4], comparedAssetId: newId(MediaAssetId) },
  suggestedPromptDelta: 'emphasize teal twin tails',
})

describe('reviewRunRowToDomain', () => {
  it('row を ReviewRun に変換する', () => {
    const row = baseRunRow()
    const run = reviewRunRowToDomain(row)

    expect(run.id).toBe(row.id)
    expect(run.takeId).toBe(row.takeId)
    expect(run.reviewers).toEqual(['technical', 'music', 'identity'])
    expect(run.status).toBe('done')
    expect(run.verdict).toBe('warn')
    expect(run.costUsd).toBeCloseTo(0.012)
    expect(run.createdAt).toEqual(row.createdAt)
  })

  it('未完了の実行は verdict が null のまま通る', () => {
    const run = reviewRunRowToDomain({ ...baseRunRow(), status: 'queued', verdict: null })
    expect(run.status).toBe('queued')
    expect(run.verdict).toBeNull()
  })

  it('レビュアが 1 つも無い行も通る（決定的チェックの前で失敗した実行）', () => {
    const run = reviewRunRowToDomain({ ...baseRunRow(), reviewers: [], status: 'failed' })
    expect(run.reviewers).toEqual([])
  })

  it('知らないレビュア名の行は投げる（黙って捨てない）', () => {
    const row = { ...baseRunRow(), reviewers: ['vibes'] } as unknown as ReviewRunRow
    expect(() => reviewRunRowToDomain(row)).toThrow()
  })

  it('知らない verdict の行は投げる', () => {
    const row = { ...baseRunRow(), verdict: 'maybe' } as unknown as ReviewRunRow
    expect(() => reviewRunRowToDomain(row)).toThrow()
  })

  it('costUsd が負の行は投げる', () => {
    expect(() => reviewRunRowToDomain({ ...baseRunRow(), costUsd: -1 })).toThrow()
  })
})

describe('reviewFindingRowToDomain', () => {
  it('row を ReviewFinding に変換する', () => {
    const row = baseFindingRow()
    const finding = reviewFindingRowToDomain(row)

    expect(finding.id).toBe(row.id)
    expect(finding.reviewRunId).toBe(row.reviewRunId)
    expect(finding.reviewer).toBe('identity')
    expect(finding.severity).toBe('warn')
    expect(finding.score).toBeCloseTo(0.72)
    expect(finding.evidence).toEqual(row.evidence)
    expect(finding.suggestedPromptDelta).toBe('emphasize teal twin tails')
  })

  it('根拠も再生成指示も無い指摘（情報提供だけ）を許す', () => {
    const finding = reviewFindingRowToDomain({
      ...baseFindingRow(),
      severity: 'info',
      score: null,
      evidence: null,
      suggestedPromptDelta: null,
    })

    expect(finding.severity).toBe('info')
    expect(finding.score).toBeNull()
    expect(finding.evidence).toBeNull()
    expect(finding.suggestedPromptDelta).toBeNull()
  })

  it('score が 0..1 の外にある行は投げる', () => {
    expect(() => reviewFindingRowToDomain({ ...baseFindingRow(), score: 1.4 })).toThrow()
    expect(() => reviewFindingRowToDomain({ ...baseFindingRow(), score: -0.1 })).toThrow()
  })

  it('severity と ReviewRun の verdict を取り違えた行は投げる（pass は severity ではない）', () => {
    const row = { ...baseFindingRow(), severity: 'pass' } as unknown as ReviewFindingRow
    expect(() => reviewFindingRowToDomain(row)).toThrow()
  })

  it('JSONB の evidence が壊れている行は投げる（黙って null で埋めない）', () => {
    const row = {
      ...baseFindingRow(),
      evidence: { frameSec: -1, bbox: null, comparedAssetId: null },
    } as unknown as ReviewFindingRow
    expect(() => reviewFindingRowToDomain(row)).toThrow()
  })

  it('bbox の要素数が 4 でない行は投げる', () => {
    const row = {
      ...baseFindingRow(),
      evidence: { frameSec: 1, bbox: [0, 0, 1], comparedAssetId: null },
    } as unknown as ReviewFindingRow
    expect(() => reviewFindingRowToDomain(row)).toThrow()
  })
})

describe('CreateReviewRunInput', () => {
  /** row から入力候補を作る。id / createdAt は敢えて残し、strip されることを確かめる。 */
  const candidate = (): Record<string, unknown> => ({ ...baseRunRow() })

  it('id と createdAt を捨てる（どちらも永続化側が採番するため）', () => {
    const parsed = CreateReviewRunInput.parse(candidate())
    expect('id' in parsed).toBe(false)
    expect('createdAt' in parsed).toBe(false)
  })

  it('costUsd を省くと 0 で始まる', () => {
    const input = candidate()
    delete input.costUsd
    expect(CreateReviewRunInput.parse(input).costUsd).toBe(0)
  })

  it('takeId が欠けていれば投げる', () => {
    const input = candidate()
    delete input.takeId
    expect(() => CreateReviewRunInput.parse(input)).toThrow()
  })
})

describe('CreateReviewFindingInput', () => {
  /** reviewRunId は addFindings の引数で渡すため、入力型は持たない。 */
  const candidate = (): Record<string, unknown> => ({ ...baseFindingRow() })

  it('id と reviewRunId を捨てる（どちらも追記時に決まるため）', () => {
    const parsed = CreateReviewFindingInput.parse(candidate())
    expect('id' in parsed).toBe(false)
    expect('reviewRunId' in parsed).toBe(false)
    expect(parsed.message).toBe('参照画像との顔の一致度が低い')
  })

  it('message が欠けていれば投げる（指摘の本体が無い）', () => {
    const input = candidate()
    delete input.message
    expect(() => CreateReviewFindingInput.parse(input)).toThrow()
  })
})
