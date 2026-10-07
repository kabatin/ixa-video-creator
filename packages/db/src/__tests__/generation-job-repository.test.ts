import { describe, expect, it } from 'vitest'
import { GenerationJobId, ShotId, TakeId, newId } from '@ixa/domain'
import type { GenerationJobRow } from '../repositories/generation-job-repository.js'
import { generationJobRowToDomain } from '../repositories/generation-job-repository.js'

/**
 * 実 DB には接続しない。row → Domain の変換だけを確かめる。
 *
 * 見たいのは **系譜（parent_take_id / regeneration_reason）が行から読めること**。
 * この 2 列は以前キューのペイロードにしか無く、積み忘れると
 * 親も理由も持たない Take が静かに確定していた。Take は Immutable（ADR-0003）で
 * 後から埋められないため、落ちていることに気付ける形にしておく必要がある。
 */

const baseRow = (): GenerationJobRow => ({
  id: newId(GenerationJobId),
  shotId: newId(ShotId),
  specHash: 'a'.repeat(64),
  requestedModel: 'AUTO',
  resolvedModel: null,
  routerDecision: null,
  status: 'queued',
  attempt: 1,
  providerJobRef: null,
  error: null,
  parentTakeId: null,
  regenerationReason: null,
  corrections: [],
    seed: null,
  queuedAt: new Date('2026-09-17T00:00:00Z'),
  startedAt: null,
  providerStartedAt: null,
  finishedAt: null,
})

describe('generationJobRowToDomain', () => {
  it('通常の生成のジョブは系譜を持たない', () => {
    const job = generationJobRowToDomain(baseRow())

    expect(job.parentTakeId).toBeNull()
    expect(job.regenerationReason).toBeNull()
  })

  it('再生成のジョブは親と理由を行から読む', () => {
    const parentTakeId = newId(TakeId)
    const job = generationJobRowToDomain({
      ...baseRow(),
      parentTakeId,
      regenerationReason: 'character_consistency: 顔の造作が参照と違う',
    })

    expect(job.parentTakeId).toBe(parentTakeId)
    expect(job.regenerationReason).toBe('character_consistency: 顔の造作が参照と違う')
  })

  it('親を消したあとの行（理由だけ）は通す', () => {
    /**
     * `parent_take_id` は ON DELETE SET NULL。親を消すとこの形になる。
     * 理由が残っていれば「最初の生成」と区別できるので、異常ではない。
     */
    const job = generationJobRowToDomain({
      ...baseRow(),
      parentTakeId: null,
      regenerationReason: 'identity: 髪の色が違う',
    })

    expect(job.parentTakeId).toBeNull()
    expect(job.regenerationReason).toBe('identity: 髪の色が違う')
  })

  it('親だけあって理由が無い行は落とす（系譜の積み忘れ）', () => {
    /**
     * 理由の書き忘れでしか生まれない形。黙って通すと
     * 「何の作り直しか」が永久に分からない Take になる。
     */
    expect(() =>
      generationJobRowToDomain({
        ...baseRow(),
        parentTakeId: newId(TakeId),
        regenerationReason: null,
      }),
    ).toThrow(/regenerationReason/)
  })
})

/**
 * 直し（PHASE 6.1）も行から読む。キューのジョブデータは `.strict()` で ID しか
 * 運ばないため、ここが唯一の経路になる。落ちると worker が同じ仕様を組み直せず
 * `spec_drift` になる。
 */
describe('直しを行から読む', () => {
  it('行の corrections がそのまま Domain に出る', () => {
    const job = generationJobRowToDomain({
      ...baseRow(),
      corrections: ['参照画像の顔に合わせ、輪郭と髪型を一致させる'],
    })
    expect(job.corrections).toEqual(['参照画像の顔に合わせ、輪郭と髪型を一致させる'])
  })

  /** 空配列が「直し無し」。`null` という別の表し方を作らない（lessons L-021）。 */
  it('直しを添えなかったジョブは空配列', () => {
    expect(generationJobRowToDomain(baseRow()).corrections).toEqual([])
  })
})
