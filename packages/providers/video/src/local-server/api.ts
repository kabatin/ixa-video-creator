import { z } from 'zod'

/**
 * 手元の生成サーバ（vpipe-api v1 契約）の応答（CLAUDE.md 規約 4「Provider レスポンスも zod で検証する」）。
 * 契約の正は vpipe-api の `docs/api.md`。**wan-api もこの契約に合わせる**（ADR-0040）。
 *
 * **未知のキーは落とす（zod の既定）が、形が違えば必ず失敗させる。**
 * 握り潰して pending へ丸めると、終わらないジョブが延々とポーリングされ続ける。
 */

/**
 * ジョブ ID。**ファイル名と URL の両方に使うので、使える文字を絞る。**
 * サーバは `job_` + Crockford base32 を返す。ここを緩めると、DB に残った参照から
 * `../` を含むパスが組み立てられる余地ができる。
 */
export const LocalServerJobId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'ジョブ ID に使えない文字が含まれています')
export type LocalServerJobId = z.infer<typeof LocalServerJobId>

const timestamp = z.string().datetime({ offset: true })

/** すべての非 2xx が返す形。 */
export const LocalServerErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    details: z.unknown().optional(),
  }),
})
export type LocalServerErrorEnvelope = z.infer<typeof LocalServerErrorEnvelope>

/**
 * `GET /v1/health`。**投入の前に空きを確かめるためだけに使う**（ADR-0031）。
 * 満杯なのに開始画像（最大 20MB）を取り寄せて送り、429 で断られるのを繰り返さないため。
 */
export const LocalServerHealth = z.object({
  status: z.string(),
  running: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  max_waiting: z.number().int().nonnegative(),
})
export type LocalServerHealth = z.infer<typeof LocalServerHealth>

export const LocalServerJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled'])
export type LocalServerJobStatus = z.infer<typeof LocalServerJobStatus>

/** 投入の応答。状態は契約上 queued だが、使わないので形だけ確かめる。 */
export const LocalServerSubmitResponse = z.object({
  id: LocalServerJobId,
  workflow: z.string().min(1),
  status: LocalServerJobStatus,
  created_at: timestamp,
})
export type LocalServerSubmitResponse = z.infer<typeof LocalServerSubmitResponse>

/** 出来た動画の実測。サーバが ffprobe で測った値。 */
const LocalServerOutputInfo = z.object({
  media_type: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.number().int().positive(),
  fps: z.number().positive(),
  duration_sec: z.number().positive(),
})

/**
 * 実際に生成した大きさ・段・ステップ数。**知っている項目だけ拾う。**
 * `details` はサーバのワークフローごとに中身が変わりうるので、raw へ丸ごと写さない
 * （何が入ってくるか分からないものを Take に残さない）。
 */
const LocalServerGenerationDetails = z.object({
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  frames: z.number().int().positive().nullish(),
  steps: z.number().int().positive().nullish(),
  quality: z.string().nullish(),
})

export const LocalServerJobResult = z.object({
  output: LocalServerOutputInfo,
  seed_used: z.number().int().nonnegative().nullable(),
  details: z.object({ generation: LocalServerGenerationDetails.nullish() }).nullish(),
})
export type LocalServerJobResult = z.infer<typeof LocalServerJobResult>

export const LocalServerJobError = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
})
export type LocalServerJobError = z.infer<typeof LocalServerJobError>

/**
 * サーバが測った各段の秒数。**wan-api が返す**（vpipe-api は返さない）ので、どの項目も無くてよい。
 *
 * 比べるときはこちらを正とする（ADR-0040）。ixa 側で時刻の差から出すと、問い合わせの間隔
 * （30 秒おき）の分だけ長く見える。
 */
export const LocalServerJobTimings = z.object({
  /** 投入からサーバが作り始めるまで（サーバの中での順番待ち）。 */
  queue_seconds: z.number().nonnegative().nullish(),
  /** 生成の口（エンジン）が動いていた時間。 */
  backend_seconds: z.number().nonnegative().nullish(),
  /** そのうちノイズ除去に使った時間（エンジンの自己申告）。 */
  sampling_seconds: z.number().nonnegative().nullish(),
  /** 書き出し・検査に使った時間。 */
  postprocess_seconds: z.number().nonnegative().nullish(),
  total_seconds: z.number().nonnegative().nullish(),
})
export type LocalServerJobTimings = z.infer<typeof LocalServerJobTimings>

const jobCommon = {
  id: LocalServerJobId,
  workflow: z.string().min(1),
  created_at: timestamp,
  started_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
  /** サーバが測った秒数。返さないサーバ（vpipe-api）では無い。 */
  timings: LocalServerJobTimings.nullish(),
}

const jobShape = z.discriminatedUnion('status', [
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
  z.object({ ...jobCommon, status: z.literal('succeeded'), result: LocalServerJobResult }),
  z.object({ ...jobCommon, status: z.literal('failed'), error: LocalServerJobError.nullable() }),
  z.object({ ...jobCommon, status: z.literal('canceled') }),
])

/**
 * 取り消しの綴りを 1 つに寄せる。**契約は `canceled`**（vpipe-api の `docs/api.md`）だが、
 * 英語では `cancelled` も普通の綴りで、同じ契約を実装する別のサーバが素直にそちらを返しうる。
 * 綴りの違いだけで「応答の形が違う」として終端の失敗にすると、取り消しが失敗として記録される。
 *
 * **新しい値を作って寄せる**（渡された応答を書き換えない）。寄せるのはこの 1 語だけで、
 * 知らない状態は寄せずにそのまま検証へ渡す（黙って canceled に化けさせない）。
 */
const normalizeCancelledSpelling = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const record: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  return record.status === 'cancelled' ? { ...record, status: 'canceled' } : value
}

/**
 * `GET /v1/jobs/{job_id}`。**状態ごとに形を分ける。**
 * `result` は succeeded のときだけ、`error` は failed のときだけ非 null（契約）。
 * succeeded なのに result が無いものを通すと、出力の無い成功を Take にしてしまう。
 */
export const LocalServerJob = z.preprocess(normalizeCancelledSpelling, jobShape)
export type LocalServerJob = z.infer<typeof jobShape>
