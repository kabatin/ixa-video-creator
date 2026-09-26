import { describe, expect, it } from 'vitest'
import { MediaAssetId } from '@ixa/domain'
import {
  BALANCED_WEIGHTS, COST_FIRST_WEIGHTS, NoEligibleModelError,
  QUALITY_FIRST_WEIGHTS, estimateCostUsd, selectModel,
} from '../router.js'
import { makeModel, makeSpec, modelId } from './fixtures.js'

const asset = () => MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

const cheap = makeModel({
  id: 'cheap', economics: { costPerSecondUsd: 0.05, typicalLatencySec: 30 },
  qualities: { characterConsistency: 0.4, motion: 0.5, physics: 0.5, cameraControl: 0.4, promptAdherence: 0.5 },
})
const premium = makeModel({
  id: 'premium', economics: { costPerSecondUsd: 0.4, typicalLatencySec: 180 },
  qualities: { characterConsistency: 0.95, motion: 0.9, physics: 0.9, cameraControl: 0.8, promptAdherence: 0.9 },
})

describe('estimateCostUsd', () => {
  it('切り上げ後の生成尺で見積もる（捨てるフレーム分も課金されるため）', () => {
    const kling = makeModel({
      id: 'kling', economics: { costPerSecondUsd: 0.1, typicalLatencySec: 60 },
      capabilities: { durations: { mode: 'enum', values: [5, 10] } } as never,
    })
    // 編集尺 3.75s → 生成尺 5s → 0.5 ドル
    expect(estimateCostUsd(makeSpec({ durationSec: 3.75 }), kling)).toBeCloseTo(0.5)
  })
})

describe('selectModel', () => {
  const withSubject = makeSpec({
    references: [{ mediaAssetId: asset(), role: 'subject', weight: 1 }],
  })

  it('人物が写る Shot では品質優先の重みで高品質モデルを選ぶ', () => {
    const d = selectModel(withSubject, [cheap, premium], {}, QUALITY_FIRST_WEIGHTS)
    expect(d.modelId).toBe(modelId('premium'))
  })

  it('コスト優先の重みでは安いモデルを選ぶ', () => {
    const d = selectModel(withSubject, [cheap, premium], {}, COST_FIRST_WEIGHTS)
    expect(d.modelId).toBe(modelId('cheap'))
  })

  it('人物が写らない Shot では人物一貫性を評価しない', () => {
    const noSubject = selectModel(makeSpec(), [cheap, premium], {}, QUALITY_FIRST_WEIGHTS)
    const withSub = selectModel(withSubject, [cheap, premium], {}, QUALITY_FIRST_WEIGHTS)
    // 人物ありのほうが premium のスコアが高くなる
    expect(withSub.score).toBeGreaterThan(noSubject.score)
  })

  it('コスト上限を超えるモデルを除外し、理由を残す', () => {
    const d = selectModel(withSubject, [cheap, premium], { maxCostUsd: 0.5 }, QUALITY_FIRST_WEIGHTS)
    expect(d.modelId).toBe(modelId('cheap'))
    expect(d.rejected.some((r) => r.modelId === modelId('premium') && r.reason.includes('上限'))).toBe(true)
  })

  it('レイテンシ上限を超えるモデルを除外する', () => {
    const d = selectModel(withSubject, [cheap, premium], { maxLatencySec: 60 })
    expect(d.modelId).toBe(modelId('cheap'))
  })

  it('許可リストで絞り込める', () => {
    const d = selectModel(withSubject, [cheap, premium], { allowedModels: [modelId('premium')] })
    expect(d.modelId).toBe(modelId('premium'))
  })

  it('候補が無ければ例外を投げ、全モデルの除外理由を含める', () => {
    const spec = makeSpec({ durationSec: 99 })
    try {
      selectModel(spec, [cheap, premium])
      expect.unreachable('例外が投げられるべき')
    } catch (error) {
      expect(error).toBeInstanceOf(NoEligibleModelError)
      const e = error as NoEligibleModelError
      expect(e.rejected).toHaveLength(2)
      expect(e.message).toContain('cheap')
      expect(e.message).toContain('premium')
    }
  })

  it('判断根拠を RouterDecision に残す', () => {
    const d = selectModel(withSubject, [cheap, premium], {}, BALANCED_WEIGHTS)
    expect(d.weightsVersion).toBe('balanced-v1')
    expect(d.reason).toContain('見積り')
    expect(d.rejected.length).toBeGreaterThan(0)
  })

  it('同じ入力で必ず同じ結果になる（再現性）', () => {
    const runs = Array.from({ length: 5 }, () => selectModel(withSubject, [cheap, premium]))
    expect(new Set(runs.map((r) => r.modelId)).size).toBe(1)
    expect(new Set(runs.map((r) => r.score)).size).toBe(1)
  })

  it('同点のときは ID 順で決まりランダムにならない', () => {
    const a = makeModel({ id: 'aaa' })
    const b = makeModel({ id: 'bbb' })
    const runs = Array.from({ length: 5 }, () => selectModel(makeSpec(), [b, a]).modelId)
    expect(new Set(runs).size).toBe(1)
    expect(runs[0]).toBe(modelId('aaa'))
  })
})

/**
 * AUTO の候補にしないモデル（ADR-0025）。最初のフレームを付けただけで、AUTO が勝手に
 * 無料のローカルの寄りへ切り替わると、生成を頼んだつもりが画像を動かすだけになる。
 */
describe('routable: false', () => {
  it('ルーターは選ばず、理由を残す', () => {
    const local = makeModel({ id: 'local', economics: { costPerSecondUsd: 0, typicalLatencySec: 1 }, routable: false })
    const d = selectModel(makeSpec(), [local, cheap])

    expect(d.modelId).toBe(modelId('cheap'))
    expect(d.rejected.some((r) => r.modelId === modelId('local') && r.reason.includes('明示'))).toBe(true)
  })
})
