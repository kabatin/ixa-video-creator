import { z } from 'zod'
import { GenerationJobId, MediaAssetId, ShotId, TakeId } from '../common/ids.js'
import { Corrections, ShotGenerationSpec } from './spec.js'

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
  /**
   * 手持ちの動画を持ち込んだ Take（ADR-0026）。アプリの外で作ったので送ったパラメータは無い。
   * **どのモデルで作ったかは分からないことがある**。分からなければ null、推定なら推定と書く。
   */
  z.object({
    kind: z.literal('import'),
    sourceModel: z.string().trim().min(1).max(120).nullable(),
    fileName: z.string().max(255).nullable(),
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

/**
 * Take 作成時の入力。
 * index は Shot 内の連番なのでリポジトリが採番する（呼び出し側に競合を意識させない）。
 * 作成時点では未レビュー・未承認で始まる。
 */
export const CreateTakeInput = Take.omit({
  id: true, index: true, createdAt: true, reviewStatus: true, humanVerdict: true,
}).extend({
  /**
   * Take と MediaAsset は相互に参照するため、そのままでは作成順序が決まらない。
   * Take.mediaAssetId は MediaAsset を要求し、
   * MediaAsset.origin の { type: 'generated', takeId } は Take を要求する。
   *
   * **呼び出し側が先に ULID を採番して循環を断つ。**
   * 手順: TakeId を採番 → その takeId を origin に入れて MediaAsset を作る
   *      → 採番済みの id と mediaAssetId で Take を作る。
   * 省略時のみリポジトリが採番する（循環が無い経路のため）。
   */
  id: TakeId.optional(),
})
export type CreateTakeInput = z.input<typeof CreateTakeInput>

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

/** regenerationReason は DB では text 列だが、無制限に長い文字列を積まない。 */
export const MAX_REGENERATION_REASON_LENGTH = 400

/** 系譜の 2 列だけを見る形。GenerationJob / その行 / 作成入力のいずれからも渡せる。 */
export type LineagePair = {
  readonly parentTakeId: string | null
  readonly regenerationReason: string | null
}

export const LINEAGE_PAIR_VIOLATION =
  'parentTakeId を持つなら regenerationReason も必要です（系譜の積み忘れ）'

/**
 * 系譜の対が成立しているかを見る。破れていれば理由、成立していれば null。
 *
 * **規則はここ 1 箇所にだけ書く。** 作成入力の検証も、DB の行を読み直すときの検査も
 * これを呼ぶ。別々に書き写すと、片方だけ直す日が来て必ずズレる。
 *
 * 規則: 親を持つなら理由も必ず持つ。
 * 逆（理由だけで親が無い）は**許す**。`parent_take_id` は `ON DELETE SET NULL` なので、
 * 親を消した再生成は「理由はあるが親が無い」形で残る。takes と同じ規則にしておくと、
 * 読む側の解釈が 1 つで済む。
 *
 * 親だけあって理由が無い値は、系譜を積む側の書き忘れでしか生まれない。
 * 黙って通すと「何の作り直しか」が永久に分からなくなる。
 */
export const lineagePairViolation = (v: LineagePair): string | null =>
  v.parentTakeId === null || v.regenerationReason !== null ? null : LINEAGE_PAIR_VIOLATION

const hasReasonWhenParented = (v: LineagePair): boolean => lineagePairViolation(v) === null

/** 毎回新しい値を返す。zod へ渡す issue を使い回さない。 */
const lineagePairIssue = (): { message: string; path: string[] } => ({
  message: LINEAGE_PAIR_VIOLATION,
  path: ['regenerationReason'],
})

/**
 * GenerationJob。
 *
 * 系譜の対の検査（`lineagePairViolation`）は **ここには付けない**。
 * `.refine()` を付けると `omit` / `pick` / `shape` が使えなくなり、
 * API のレスポンス型など派生スキーマが作れなくなるため。
 * 検査は作成入力（`CreateGenerationJobInput`）と、DB の行を読み直す側で行う。
 */
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

  /**
   * 系譜（DOMAIN.md §10）。再生成で積まれたジョブだけが持つ。
   *
   * **ここが系譜の正である。** キューのジョブデータには積まない。
   * ジョブデータに積む形だと「GenerationJob 行は作ったがペイロードに入れ忘れた」
   * 隙間が生まれ、親も理由も持たない Take が静かに確定していた。
   * Take は Immutable（ADR-0003）なので後から埋められない。
   * 行を作る呼び出しと系譜を書く呼び出しを同じ 1 回にまとめて、その隙間を無くす。
   */
  parentTakeId: TakeId.nullable(),
  regenerationReason: z.string().nullable(),

  /**
   * レビューの指摘から人が選んだ直し（PHASE 6.1）。
   *
   * **ここが直しの正である。** キューのジョブデータには積まない（`job-data.ts` は
   * `.strict()` で ID だけを運ぶ）。系譜と同じ理由で、行を作る呼び出しに含めて隙間を無くす。
   * worker は処理時に仕様を組み直すため、直しが行に無いと同じ仕様を再現できず
   * `spec_drift` で落ちる。
   *
   * **`null` ではなく空配列が「直し無し」。** 直しを添えなかったジョブにとって
   * 「無い」は分からない状態ではなく事実なので、2 通りの表し方を作らない（lessons L-021）。
   */
  corrections: z.array(z.string().min(1)),

  queuedAt: z.date(),
  /** 生成先へ送った時刻。 */
  startedAt: z.date().nullable(),
  /**
   * 生成先が**作り始めた**時刻（問い合わせで初めて「作成中」が返った時刻）。まだなら null。
   * 送った後も生成先の中で順番を待つことがある（vpipe は 1 本ずつ作る。制作者 2026-10-04「カット２，３が作成中になってる」）。
   * 経過と生成時間はここから数える。
   */
  providerStartedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
})
export type GenerationJob = z.infer<typeof GenerationJob>

/** GenerationJob 作成時の入力。キューへ入れる時点では未解決の項目が多い。 */
export const CreateGenerationJobInput = GenerationJob.omit({
  id: true, queuedAt: true, startedAt: true, providerStartedAt: true, finishedAt: true,
})
  .extend({
    status: GenerationJobStatus.default('queued'),
    attempt: z.number().int().positive().default(1),
    resolvedModel: ModelId.nullable().default(null),
    routerDecision: RouterDecision.nullable().default(null),
    providerJobRef: z.string().nullable().default(null),
    error: GenerationJob.shape.error.default(null),
    /**
     * 系譜を書けるのはここだけ。作成後の更新では変えられない
     * （`UpdateGenerationJobPatch` に含めていない）。
     * 再生成の配線は必ずこの 2 つを渡すこと。
     */
    parentTakeId: TakeId.nullable().default(null),
    regenerationReason: z
      .string()
      .min(1)
      .max(MAX_REGENERATION_REASON_LENGTH)
      .nullable()
      .default(null),
    /** 直しは添えないのが既定。上限は `spec.ts` の `Corrections` が持つ（写さない）。 */
    corrections: Corrections.default([]),
  })
  .refine(hasReasonWhenParented, lineagePairIssue())
export type CreateGenerationJobInput = z.input<typeof CreateGenerationJobInput>

/**
 * ジョブ進行中に更新される列。
 * **系譜（parentTakeId / regenerationReason）は入れない。** 作成時に決まり、後から変わらない。
 */
export const UpdateGenerationJobPatch = GenerationJob.pick({
  status: true, resolvedModel: true, routerDecision: true, attempt: true,
  providerJobRef: true, error: true, startedAt: true, providerStartedAt: true, finishedAt: true,
}).partial()
export type UpdateGenerationJobPatch = z.input<typeof UpdateGenerationJobPatch>
