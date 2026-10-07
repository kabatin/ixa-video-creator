import { describe, expect, it } from 'vitest'
import { ShotId, newId } from '@ixa/domain'
import { describeRemakePlan, planFromRemakeResult } from '@/lib/remake-final-plan'
import type { WireBulkRemakeFinalResult } from '@/lib/shot-bulk-api'
import { ModelId } from '@ixa/domain'

/**
 * 押す前の下見の読み方（ADR-0042 段 4）。
 * **本数・掛かる時間・終わる時刻**を先に言い、飛ばす Shot は理由ごと並べる。
 */

const A = newId(ShotId)
const B = newId(ShotId)
const MODEL = ModelId.parse('vpipe/minimax-h3-turbo-final')

const result = (
  overrides: Partial<WireBulkRemakeFinalResult> = {},
): WireBulkRemakeFinalResult => ({
  results: [
    { shotId: A, ok: true, jobIds: [], resolvedModel: MODEL, estimatedLatencySec: 600 },
    { shotId: B, ok: false, reason: '採用している Take がありません' },
  ],
  enqueuedCount: 0,
  estimatedTotalUsd: 0,
  estimatedTotalLatencySec: 600,
  dryRun: true,
  ...overrides,
})

const SHOTS = [
  { id: A, code: 'CUT-38' },
  { id: B, code: 'CUT-39' },
]

describe('planFromRemakeResult', () => {
  it('積める本数と、飛ばす Shot をコードと理由で並べる', () => {
    const plan = planFromRemakeResult(result(), SHOTS)

    expect(plan.targetCount).toBe(1)
    expect(plan.skipped).toEqual(['CUT-39 — 採用している Take がありません'])
  })

  /** 一覧に無い Shot（他 Project など）は ID のまま出す。**黙って落とさない。** */
  it('コードを引けない Shot は ID で出す', () => {
    const plan = planFromRemakeResult(result(), [])

    expect(plan.skipped[0]).toContain(B)
  })
})

describe('describeRemakePlan', () => {
  const now = new Date('2026-10-07T22:20:00')

  it('本数・見込み・終わる時刻を言う', () => {
    const plan = planFromRemakeResult(result({ estimatedTotalLatencySec: 5400 }), SHOTS)

    expect(describeRemakePlan(plan, now)).toBe(
      '1 本を本番で作り直します。見込み 約 1 時間 30 分（終わり 23:50 頃）。ほかの生成が動いていれば、その後になります。',
    )
  })

  /** 夜に積む操作なので、日をまたぐ。「2:10」とだけ出すと今日の 2 時に見える。 */
  it('日をまたぐ終わりには「翌」を付ける', () => {
    const plan = planFromRemakeResult(result({ estimatedTotalLatencySec: 60 * 60 * 5 }), SHOTS)

    expect(describeRemakePlan(plan, now)).toContain('翌 3:20')
  })

  it('0 本なら時刻を出さない', () => {
    const plan = planFromRemakeResult(
      result({ results: [{ shotId: B, ok: false, reason: 'だめ' }], estimatedTotalLatencySec: 0 }),
      SHOTS,
    )

    expect(describeRemakePlan(plan, now)).toBe('本番で作り直せる Shot がありません。')
  })
})
