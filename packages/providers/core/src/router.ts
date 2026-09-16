import { quantizeDuration } from '@ixa/domain'
import type { ModelId, RouterDecision, ShotGenerationSpec } from '@ixa/domain'
import type { VideoModelDescriptor } from './provider.js'
import { validateAgainstCapabilities } from './validate.js'

/**
 * スコアリングの重み。Project 設定で品質優先／コスト優先へ振れるようにする。
 * バージョンを付けて RouterDecision に残し、後から「なぜこのモデルが選ばれたか」を再現できるようにする。
 */
export type RouterWeights = {
  readonly version: string
  readonly characterConsistency: number
  readonly motion: number
  readonly physics: number
  readonly cameraControl: number
  readonly promptAdherence: number
  readonly cost: number
  readonly latency: number
}

export const BALANCED_WEIGHTS: RouterWeights = Object.freeze({
  version: 'balanced-v1',
  characterConsistency: 1.0,
  motion: 0.6,
  physics: 0.4,
  cameraControl: 0.5,
  promptAdherence: 0.8,
  cost: 0.7,
  latency: 0.2,
})

export const QUALITY_FIRST_WEIGHTS: RouterWeights = Object.freeze({
  ...BALANCED_WEIGHTS,
  version: 'quality-first-v1',
  characterConsistency: 1.5,
  promptAdherence: 1.2,
  cost: 0.2,
})

export const COST_FIRST_WEIGHTS: RouterWeights = Object.freeze({
  ...BALANCED_WEIGHTS,
  version: 'cost-first-v1',
  cost: 2.0,
  latency: 0.6,
})

export type RouterConstraints = {
  readonly maxCostUsd?: number
  readonly maxLatencySec?: number
  readonly allowedModels?: readonly ModelId[]
}

export class NoEligibleModelError extends Error {
  constructor(readonly rejected: readonly { modelId: ModelId; reason: string }[]) {
    super(
      '要求を満たせるモデルがありません:\n' +
        rejected.map((r) => `- ${r.modelId}: ${r.reason}`).join('\n'),
    )
    this.name = 'NoEligibleModelError'
  }
}

/** 生成尺は切り上げ後の値で見積もる。捨てるフレーム分も課金されるため（ADR-0011）。 */
export const estimateCostUsd = (spec: ShotGenerationSpec, model: VideoModelDescriptor): number => {
  const billedSec = quantizeDuration(spec.durationSec, model.capabilities.durations)
  return billedSec * model.economics.costPerSecondUsd
}

/**
 * Shot の要求に応じて重みを調整する。
 * 人物が写らない Shot で人物一貫性を評価しても意味がないため。
 */
const relevance = (spec: ShotGenerationSpec) => ({
  hasSubject: spec.references.some((r) => r.role === 'subject' || r.role === 'wardrobe'),
  wantsMovement: spec.camera.movement !== null && spec.camera.movement !== 'static',
})

const normalize = (value: number, max: number): number => (max <= 0 ? 0 : Math.min(value / max, 1))

/**
 * 決定的なルールベースの Model Router（ADR-0004）。
 * LLM を使わない理由: テスト可能・再現可能・無料・レイテンシゼロ。
 */
export const selectModel = (
  spec: ShotGenerationSpec,
  models: readonly VideoModelDescriptor[],
  constraints: RouterConstraints = {},
  weights: RouterWeights = BALANCED_WEIGHTS,
): RouterDecision => {
  const rejected: { modelId: ModelId; reason: string }[] = []
  const eligible: { model: VideoModelDescriptor; cost: number }[] = []

  // --- ハードフィルタ
  for (const model of models) {
    if (constraints.allowedModels && !constraints.allowedModels.includes(model.id)) {
      rejected.push({ modelId: model.id, reason: '許可されたモデルに含まれない' })
      continue
    }

    const violations = validateAgainstCapabilities(spec, model)
    if (violations.length > 0) {
      rejected.push({ modelId: model.id, reason: violations.join(' / ') })
      continue
    }

    const cost = estimateCostUsd(spec, model)
    if (constraints.maxCostUsd !== undefined && cost > constraints.maxCostUsd) {
      rejected.push({
        modelId: model.id,
        reason: `見積り $${cost.toFixed(3)} が上限 $${constraints.maxCostUsd} を超える`,
      })
      continue
    }

    if (
      constraints.maxLatencySec !== undefined &&
      model.economics.typicalLatencySec > constraints.maxLatencySec
    ) {
      rejected.push({
        modelId: model.id,
        reason: `想定 ${model.economics.typicalLatencySec}s が上限 ${constraints.maxLatencySec}s を超える`,
      })
      continue
    }

    eligible.push({ model, cost })
  }

  if (eligible.length === 0) throw new NoEligibleModelError(rejected)

  // --- 重み付きスコアリング
  const maxCost = Math.max(...eligible.map((e) => e.cost))
  const maxLatency = Math.max(...eligible.map((e) => e.model.economics.typicalLatencySec))
  const rel = relevance(spec)

  const scored = eligible.map(({ model, cost }) => {
    const q = model.qualities
    const score =
      (rel.hasSubject ? weights.characterConsistency * q.characterConsistency : 0) +
      (rel.wantsMovement ? weights.motion * q.motion : 0) +
      weights.physics * q.physics +
      (spec.camera.movement !== null ? weights.cameraControl * q.cameraControl : 0) +
      weights.promptAdherence * q.promptAdherence -
      weights.cost * normalize(cost, maxCost) -
      weights.latency * normalize(model.economics.typicalLatencySec, maxLatency)
    return { model, cost, score }
  })

  // 同点のときは ID 順で決める。ランダム性を持ち込まない（再現性のため）。
  scored.sort((a, b) => (b.score - a.score) || (a.model.id < b.model.id ? -1 : 1))
  const best = scored[0]
  if (!best) throw new NoEligibleModelError(rejected)

  const others = scored.slice(1).map((s) => ({
    modelId: s.model.id,
    reason: `スコア ${s.score.toFixed(3)} < ${best.score.toFixed(3)}`,
  }))

  return {
    modelId: best.model.id,
    score: best.score,
    reason:
      `見積り $${best.cost.toFixed(3)} / 想定 ${best.model.economics.typicalLatencySec}s` +
      `（候補 ${eligible.length} 件、除外 ${rejected.length} 件）`,
    rejected: [...rejected, ...others],
    weightsVersion: weights.version,
  }
}
