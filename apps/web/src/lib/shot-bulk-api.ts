import {
  GenerationJobId,
  ModelId,
  ShotId,
  ShotStatus,
  TakeId,
  type ProjectId,
  ShotCamera,
} from '@ixa/domain'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { MAX_TAKES_PER_REQUEST, UpdateShotBody, WireShot } from '@/lib/api-schemas'
import type { Requester } from '@/lib/requester'

/**
 * 一括操作の呼び出し口（P58-2）。
 *
 * **一括生成はサーバ側で 1 回にまとめる。** 画面から 27 回叩くと、20 件目まで投入してから
 * 予算で止まり、投入済みの分だけ課金される。合計を先に見積もって全件止めるには、
 * サーバが全件を見てから投入するしかない（docs/ARCHITECTURE.md §11）。
 *
 * どの経路も**途中で止まらない**。1 件ずつの結果が `results` に並んで返る。
 * 全体を 1 つの成否に畳まない（lessons L-015）。読み方は `@/lib/shot-bulk` の
 * `summarizeBulkResult` に置き、ここは受け取りと検証だけを持つ。
 */

/**
 * 1 件ぶんの結果。`ok` で判別する。
 * **`ok: false` は必ず `reason` を持つ。** 空文字も許さない。
 * 理由の無い失敗を受け取ると、画面は「2 件失敗」としか言えなくなる。
 */
const failedOutcome = z.object({
  shotId: ShotId,
  ok: z.literal(false),
  reason: z.string().min(1),
})

/** 成功側に必ず入る列。各経路はこれに固有の列を足す。 */
const succeededShape = { shotId: ShotId, ok: z.literal(true) } as const

// --- 一括生成 ---

export const WireBulkGenerateOutcome = z.discriminatedUnion('ok', [
  z.object({ ...succeededShape, jobIds: z.array(GenerationJobId), resolvedModel: ModelId }),
  failedOutcome,
])
export type WireBulkGenerateOutcome = z.infer<typeof WireBulkGenerateOutcome>

export const WireBulkGenerateResult = z.object({
  results: z.array(WireBulkGenerateOutcome),
  /** 投入した分の見積の合計。予算を超える要求は 1 件も投入されないので、これは実際に積んだ額。 */
  estimatedTotalUsd: z.number(),
  enqueuedCount: z.number().int().nonnegative(),
})
export type WireBulkGenerateResult = z.infer<typeof WireBulkGenerateResult>

/**
 * 送る本文。
 *
 * **件数の上限（1..200）はここで写さない。** 上限は予算と同じくサーバの持ち物で、
 * 書き写すと片方だけ直る日が来てズレる（lessons L-016）。
 * 201 件を選んだら、そのまま送ってサーバの 422 の理由を画面に出す。
 * `count` だけは既存の `MAX_TAKES_PER_REQUEST`（1 件生成と同じ定数）を使い回す。
 */
export const BulkGenerateBody = z.object({
  shotIds: z.array(ShotId),
  model: z.union([ModelId, z.literal('AUTO')]),
  count: z.number().int().min(1).max(MAX_TAKES_PER_REQUEST),
})
export type BulkGenerateBody = z.input<typeof BulkGenerateBody>

// --- 一括採用 ---

/** `only` は Take が 1 本だけのときに採用する。複数あれば選ばず失敗として残す。 */
export const BulkSelectRule = z.enum(['only', 'latest'])
export type BulkSelectRule = z.infer<typeof BulkSelectRule>

export const WireBulkSelectOutcome = z.discriminatedUnion('ok', [
  z.object({ ...succeededShape, takeId: TakeId, status: ShotStatus }),
  failedOutcome,
])
export type WireBulkSelectOutcome = z.infer<typeof WireBulkSelectOutcome>

export const WireBulkSelectResult = z.object({ results: z.array(WireBulkSelectOutcome) })
export type WireBulkSelectResult = z.infer<typeof WireBulkSelectResult>

export const BulkSelectBody = z.object({
  shotIds: z.array(ShotId),
  rule: BulkSelectRule,
})
export type BulkSelectBody = z.input<typeof BulkSelectBody>

// --- 一括削除 ---

export const WireBulkDeleteResult = z.object({
  results: z.array(
    z.discriminatedUnion('ok', [
      z.object({ shotId: z.string(), ok: z.literal(true) }),
      z.object({ shotId: z.string(), ok: z.literal(false), reason: z.string() }),
    ]),
  ),
  deletedCount: z.number(),
})
export type WireBulkDeleteResult = z.infer<typeof WireBulkDeleteResult>

// --- 一括変更 ---

/** 一括で変えてよい列だけ。尺・順序を一括で揃えるとタイムラインが壊れるため含めない。 */
export const BulkShotPatch = UpdateShotBody.pick({
  mood: true,
  locationId: true,
  description: true,
}).extend({
  /**
   * **部分更新。** 全体の置換にすると、「景別だけ変える」つもりで 27 件の
   * angle や lensMm がまとめて消える。サーバが Shot ごとに既存と merge する。
   */
  camera: ShotCamera.partial().strict().optional(),
})
export type BulkShotPatch = z.input<typeof BulkShotPatch>

export const WireBulkUpdateOutcome = z.discriminatedUnion('ok', [
  z.object({ ...succeededShape, shot: WireShot }),
  failedOutcome,
])
export type WireBulkUpdateOutcome = z.infer<typeof WireBulkUpdateOutcome>

export const WireBulkUpdateResult = z.object({ results: z.array(WireBulkUpdateOutcome) })
export type WireBulkUpdateResult = z.infer<typeof WireBulkUpdateResult>

export const BulkUpdateBody = z.object({
  shotIds: z.array(ShotId),
  patch: BulkShotPatch,
})
export type BulkUpdateBody = z.input<typeof BulkUpdateBody>

// --- 予算で拒否されたとき ---

/**
 * API の失敗の封筒。合計と上限は **`fields` の中に文字列の配列**で入る。
 * 既存の `fail(message, fields)` は `fields` を `Record<string, string[]>` にしか
 * できないため（`apps/api/src/response.ts`）。上限が無いときは `'無制限'` が来る。
 */
const WireErrorEnvelope = z.object({
  success: z.literal(false),
  error: z.string(),
  fields: z.record(z.array(z.string())).optional(),
})

/**
 * 上限が設定されていないときに API が入れる文字列。`Number()` すると NaN になる。
 *
 * **いまの API はこの値を返さない。** 422 はプロジェクト予算の超過だけになり、
 * 予算未設定の Project ではそもそも 422 が起きないため。
 * それでも読み分けを残すのは、外した場合に `NaN → null` へ落ちて
 * 「上限なし」が「上限が分からない」に化けるため（lessons L-015）。防御のために置く。
 */
const UNLIMITED_FIELD = '無制限'

/** `fields` の 1 番目を数値に。無い・数値でないものは null。 */
const amountFrom = (values: readonly string[] | undefined): number | null => {
  const raw = values?.[0]
  if (raw === undefined) return null
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 上限。**「上限なし」と「上限が分からない」を同じ値に畳まない**（lessons L-015）。
 * 前者は選択を減らしても直らない（当たったのは Shot 上限か要求上限）。
 * 後者は表示を控えるべきもの。畳むと画面の出し方が逆になる。
 */
const limitFrom = (values: readonly string[] | undefined): number | 'unlimited' | null =>
  values?.[0] === UNLIMITED_FIELD ? 'unlimited' : amountFrom(values)

/**
 * どの上限に当たったか。画面が「どれを緩めればよいか」を出せるようにする。
 *
 * **422 で来るのは実質 `project_budget` だけ。** 1 回の依頼の上限（`request`）と
 * Shot の累積上限（`shot`）は Shot ごとに当たるので、`results` の `ok: false` の
 * `reason` に入って返る。合計で止まるのはプロジェクト予算だけ。
 */
export const BulkCostLimitKind = z.enum(['project_budget', 'shot', 'request'])
export type BulkCostLimitKind = z.infer<typeof BulkCostLimitKind>

/** 知らない値・無いときは null。未知の種別を既知のどれかに寄せない。 */
const limitKindFrom = (values: readonly string[] | undefined): BulkCostLimitKind | null => {
  const parsed = BulkCostLimitKind.safeParse(values?.[0])
  return parsed.success ? parsed.data : null
}

/**
 * 予算を超えて **1 件も投入されなかった**とき。
 * 「拒否された」を「呼び出しに失敗した」と混ぜない。前者は選択を減らせば直る。
 */
export type BulkGenerateRejection = {
  readonly message: string
  readonly estimatedTotalUsd: number | null
  /** `'unlimited'` は上限が設定されていないこと。`null` は値が付いてこなかったこと。 */
  readonly limitUsd: number | 'unlimited' | null
  readonly limit: BulkCostLimitKind | null
}

/**
 * 422 を拒否として読む。422 でない／本文が読めないときは null を返し、
 * 呼び出し側が元の例外を投げ直す。ここで握り潰すと「押しても何も起きない」になる。
 */
export const parseBulkGenerateRejection = (error: unknown): BulkGenerateRejection | null => {
  if (!(error instanceof ApiError) || error.status !== 422) return null
  const parsed = ((): unknown => {
    try {
      return JSON.parse(error.body) as unknown
    } catch {
      return null
    }
  })()
  const envelope = WireErrorEnvelope.safeParse(parsed)
  if (!envelope.success) return null
  return {
    message: envelope.data.error,
    estimatedTotalUsd: amountFrom(envelope.data.fields?.estimatedTotalUsd),
    limitUsd: limitFrom(envelope.data.fields?.limitUsd),
    limit: limitKindFrom(envelope.data.fields?.cost),
  }
}

// --- 呼び出し口 ---

export type ShotBulkApi = {
  /**
   * 選んだ Shot をまとめて生成に回す。202。
   *
   * **プロジェクト予算**を合計が超えると 1 件も投入されず、422 で `ApiError` が投げられる。
   * 画面は `parseBulkGenerateRejection` で理由と合計・上限を取り出して出すこと。
   * 1 件ごとの費用上限に当たったものは 422 にならず、`results` に `ok: false` で並ぶ。
   */
  bulkGenerateShots: (
    projectId: ProjectId,
    body: BulkGenerateBody,
  ) => Promise<WireBulkGenerateResult>
  /** 規則に従って Take を採用する。Take が無い Shot は `ok: false` で残る。 */
  bulkSelectTakes: (projectId: ProjectId, body: BulkSelectBody) => Promise<WireBulkSelectResult>
  /** ソフトデリート。取り消しは無い（確認は画面が取る）。 */
  bulkDeleteShots: (projectId: ProjectId, shotIds: readonly ShotId[]) => Promise<WireBulkDeleteResult>
  /** 共通の値をまとめて変える。 */
  bulkUpdateShots: (projectId: ProjectId, body: BulkUpdateBody) => Promise<WireBulkUpdateResult>
}

const bulkPath = (projectId: ProjectId, suffix = ''): string =>
  `/projects/${encodeURIComponent(projectId)}/shots/bulk${suffix}`

export const createShotBulkApi = (requester: Requester): ShotBulkApi => ({
  bulkGenerateShots: async (projectId, body) =>
    requester.post(
      bulkPath(projectId, '/generate'),
      BulkGenerateBody.parse(body),
      WireBulkGenerateResult,
    ),

  bulkSelectTakes: async (projectId, body) =>
    requester.post(
      bulkPath(projectId, '/select-take'),
      BulkSelectBody.parse(body),
      WireBulkSelectResult,
    ),

  bulkDeleteShots: async (projectId, shotIds) =>
    requester.post(bulkPath(projectId, '/delete'), { shotIds: [...shotIds] }, WireBulkDeleteResult),

  bulkUpdateShots: async (projectId, body) =>
    requester.patch(bulkPath(projectId), BulkUpdateBody.parse(body), WireBulkUpdateResult),
})
