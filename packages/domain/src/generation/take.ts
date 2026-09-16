import { z } from 'zod'
import { GenerationJobId, MediaAssetId, ShotId, TakeId } from '../common/ids.js'
import { ShotGenerationSpec } from './spec.js'

export const ProviderId = z.string().min(1).brand<'ProviderId'>()
export type ProviderId = z.infer<typeof ProviderId>

export const ModelId = z.string().min(1).brand<'ModelId'>()
export type ModelId = z.infer<typeof ModelId>

export const ReviewStatus = z.enum(['pending', 'passed', 'warned', 'failed', 'skipped'])
export type ReviewStatus = z.infer<typeof ReviewStatus>

export const HumanVerdict = z.enum(['unreviewed', 'approved', 'rejected'])
export type HumanVerdict = z.infer<typeof HumanVerdict>

/**
 * 実際に Provider へ送ったパラメータ。
 * CLI 経由の Provider（ADR-0012）は再現性が弱いため、種別を分けて記録する。
 */
export const ProviderParams = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), request: z.record(z.unknown()) }),
  z.object({
    kind: z.literal('cli'),
    command: z.string(),
    cwd: z.string(),
    cliVersion: z.string(),
    exitCode: z.number().int(),
    stdoutDigest: z.string(),
  }),
])
export type ProviderParams = z.infer<typeof ProviderParams>

/**
 * 生成結果。Immutable（ADR-0003）。
 * reviewStatus と humanVerdict 以外を作成後に更新しないこと。
 */
export const Take = z.object({
  id: TakeId,
  shotId: ShotId,
  index: z.number().int().positive(),

  mediaAssetId: MediaAssetId,

  spec: ShotGenerationSpec,
  specHash: z.string().length(64),
  providerId: ProviderId,
  modelId: ModelId,
  providerParams: ProviderParams,
  seedUsed: z.number().int().nullable(),

  costUsd: z.number().nonnegative(),
  generationTimeSec: z.number().nonnegative(),

  parentTakeId: TakeId.nullable(),
  regenerationReason: z.string().nullable(),

  reviewStatus: ReviewStatus,
  humanVerdict: HumanVerdict,
  createdAt: z.date(),
})
export type Take = z.infer<typeof Take>

/** Take で更新してよい列はこれだけ。DB リポジトリ実装はこれを守ること。 */
export const TAKE_MUTABLE_FIELDS = Object.freeze(['reviewStatus', 'humanVerdict'] as const)

export const TakeUpdate = Take.pick({ reviewStatus: true, humanVerdict: true }).partial()
export type TakeUpdate = z.infer<typeof TakeUpdate>

export const GenerationJobStatus = z.enum([
  'queued', 'running', 'succeeded', 'failed', 'cancelled',
])
export type GenerationJobStatus = z.infer<typeof GenerationJobStatus>

export const RouterDecision = z.object({
  modelId: ModelId,
  score: z.number(),
  reason: z.string(),
  rejected: z.array(z.object({ modelId: ModelId, reason: z.string() })),
  weightsVersion: z.string(),
})
export type RouterDecision = z.infer<typeof RouterDecision>

export const GenerationJob = z.object({
  id: GenerationJobId,
  shotId: ShotId,
  specHash: z.string().length(64),
  requestedModel: z.union([ModelId, z.literal('AUTO')]),
  resolvedModel: ModelId.nullable(),
  routerDecision: RouterDecision.nullable(),
  status: GenerationJobStatus,
  attempt: z.number().int().positive(),
  providerJobRef: z.string().nullable(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).nullable(),
  queuedAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type GenerationJob = z.infer<typeof GenerationJob>
