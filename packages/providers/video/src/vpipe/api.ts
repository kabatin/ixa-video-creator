import { z } from 'zod'

/**
 * vpipe-api（v1）の応答（CLAUDE.md 規約 4「Provider レスポンスも zod で検証する」）。
 * 契約の正は vpipe-api の `docs/api.md`。
 *
 * **未知のキーは落とす（zod の既定）が、形が違えば必ず失敗させる。**
 * 握り潰して pending へ丸めると、終わらないジョブが延々とポーリングされ続ける。
 */

/**
 * ジョブ ID。**ファイル名と URL の両方に使うので、使える文字を絞る。**
 * vpipe-api は `job_` + Crockford base32 を返す。ここを緩めると、DB に残った参照から
 * `../` を含むパスが組み立てられる余地ができる。
 */
export const VpipeJobId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'ジョブ ID に使えない文字が含まれています')
export type VpipeJobId = z.infer<typeof VpipeJobId>

const timestamp = z.string().datetime({ offset: true })

/** すべての非 2xx が返す形。 */
export const VpipeErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    details: z.unknown().optional(),
  }),
})
export type VpipeErrorEnvelope = z.infer<typeof VpipeErrorEnvelope>

/** `POST /v1/workflows/{workflow_id}/jobs` の 202。 */
/**
 * `GET /v1/health`。**投入の前に空きを確かめるためだけに使う**（ADR-0031）。
 * 満杯なのに開始画像（最大 20MB）を取り寄せて送り、429 で断られるのを繰り返さないため。
 */
export const VpipeHealth = z.object({
  status: z.string(),
  running: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  max_waiting: z.number().int().nonnegative(),
})
export type VpipeHealth = z.infer<typeof VpipeHealth>

export const VpipeJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled'])
export type VpipeJobStatus = z.infer<typeof VpipeJobStatus>

/** 投入の応答。状態は契約上 queued だが、使わないので形だけ確かめる。 */
export const VpipeSubmitResponse = z.object({
  id: VpipeJobId,
  workflow: z.string().min(1),
  status: VpipeJobStatus,
  created_at: timestamp,
})
export type VpipeSubmitResponse = z.infer<typeof VpipeSubmitResponse>

/** 出来た動画の実測。vpipe-api が ffprobe で測った値。 */
const VpipeOutputInfo = z.object({
  media_type: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.number().int().positive(),
  fps: z.number().positive(),
  duration_sec: z.number().positive(),
})

/**
 * 実際に生成した大きさ・段・ステップ数。**知っている項目だけ拾う。**
 * `details` は vpipe-api のワークフローごとに中身が変わりうるので、raw へ丸ごと写さない
 * （何が入ってくるか分からないものを Take に残さない）。
 */
const VpipeGenerationDetails = z.object({
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  frames: z.number().int().positive().nullish(),
  steps: z.number().int().positive().nullish(),
  quality: z.string().nullish(),
})

export const VpipeJobResult = z.object({
  output: VpipeOutputInfo,
  seed_used: z.number().int().nonnegative().nullable(),
  details: z.object({ generation: VpipeGenerationDetails.nullish() }).nullish(),
})
export type VpipeJobResult = z.infer<typeof VpipeJobResult>

export const VpipeJobError = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
})
export type VpipeJobError = z.infer<typeof VpipeJobError>

const jobCommon = {
  id: VpipeJobId,
  workflow: z.string().min(1),
  created_at: timestamp,
  started_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
}

/**
 * `GET /v1/jobs/{job_id}`。**状態ごとに形を分ける。**
 * `result` は succeeded のときだけ、`error` は failed のときだけ非 null（契約）。
 * succeeded なのに result が無いものを通すと、出力の無い成功を Take にしてしまう。
 */
export const VpipeJob = z.discriminatedUnion('status', [
  z.object({
    ...jobCommon,
    status: z.literal('queued'),
    /** 1 始まりの待ち順。進み具合ではないので progress にしない。 */
    queue_position: z.number().int().positive().nullish(),
  }),
  z.object({
    ...jobCommon,
    status: z.literal('running'),
    /** 0..1 のノイズ除去の進み具合。分からなければ null。 */
    progress: z.number().min(0).max(1).nullish(),
  }),
  z.object({ ...jobCommon, status: z.literal('succeeded'), result: VpipeJobResult }),
  z.object({ ...jobCommon, status: z.literal('failed'), error: VpipeJobError.nullable() }),
  z.object({ ...jobCommon, status: z.literal('canceled') }),
])
export type VpipeJob = z.infer<typeof VpipeJob>
