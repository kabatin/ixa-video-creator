import { describe, expect, it } from 'vitest'
import { ShotId, newId } from '@ixa/domain'
import { describeUpscalePlan, planFromUpscaleResult } from '@/lib/upscale-plan'
import type { WireBulkUpscaleResult } from '@/lib/shot-bulk-api'

/** まとめて解像度を上げる前の下見の読み方。飛ばす Shot は理由ごと並べる（L-015）。 */

const A = newId(ShotId)
const B = newId(ShotId)

const result: WireBulkUpscaleResult = {
  results: [
    { shotId: A, ok: true, jobId: null },
    { shotId: B, ok: false, reason: 'この Take は、すでに解像度を上げたものです' },
  ],
  enqueuedCount: 0,
  dryRun: true,
}

describe('planFromUpscaleResult', () => {
  it('積める本数と、飛ばす Shot をコードと理由で並べる', () => {
    const plan = planFromUpscaleResult(result, [
      { id: A, code: 'CUT-01' },
      { id: B, code: 'CUT-02' },
    ])

    expect(plan.targetCount).toBe(1)
    expect(plan.skipped).toEqual(['CUT-02 — この Take は、すでに解像度を上げたものです'])
  })

  it('コードを引けない Shot は ID で出す', () => {
    expect(planFromUpscaleResult(result, []).skipped[0]).toContain(B)
  })
})

describe('describeUpscalePlan', () => {
  it('本数を言う', () => {
    expect(describeUpscalePlan({ targetCount: 3, skipped: [] })).toContain('3 本')
  })

  it('0 本なら上げられるものが無いと言う', () => {
    expect(describeUpscalePlan({ targetCount: 0, skipped: [] })).toBe(
      '解像度を上げられる Shot がありません。',
    )
  })
})
