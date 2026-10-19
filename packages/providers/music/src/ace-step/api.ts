import { LocalServerJobError, LocalServerJobId, LocalServerJobTimings } from '@ixa/provider-video'
import { z } from 'zod'

/**
 * ace-step-api の応答（ADR-0048。契約の正は ace-step-api の `docs/api.md`）。
 *
 * 流れと失敗の封筒は klein-api と同じで、**出来上がりが複数曲の WAV** であることと、
 * 1 曲ごとに実際の長さ（秒）を返すことだけが違う。
 * 未知のキーは落とし、形が違えば必ず失敗させる（pending へ丸めない）。
 */

/** 出来上がった 1 曲。`index` で `GET /v1/jobs/{id}/output?index=N` を引く。 */
export const AceStepOutputInfo = z.object({
  index: z.number().int().nonnegative(),
  media_type: z.literal('audio/wav'),
  /** 実際の長さ（秒）。頼んだ長さと少し違うことがある。 */
  duration_sec: z.number().positive(),
  seed_used: z.number().int().nonnegative().nullable(),
})
export type AceStepOutputInfo = z.infer<typeof AceStepOutputInfo>

export const AceStepJobResult = z.object({
  outputs: z.array(AceStepOutputInfo).min(1),
  seed_used: z.number().int().nonnegative().nullable(),
  /** MiniMax-Music3 が返す作り方の記録（実際に歌なしで作ったか `generation.instrumental` など）。中身は見ずに記録に残す。 */
  details: z.record(z.unknown()).nullish(),
})

const timestamp = z.string().datetime({ offset: true })

const jobCommon = {
  id: LocalServerJobId,
  workflow: z.string().min(1),
  created_at: timestamp,
  started_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
  timings: LocalServerJobTimings.nullish(),
}

const jobShape = z.discriminatedUnion('status', [
  z.object({ ...jobCommon, status: z.literal('queued') }),
  z.object({ ...jobCommon, status: z.literal('running'), progress: z.number().min(0).max(1).nullish() }),
  z.object({ ...jobCommon, status: z.literal('succeeded'), result: AceStepJobResult }),
  z.object({ ...jobCommon, status: z.literal('failed'), error: LocalServerJobError.nullable() }),
  z.object({ ...jobCommon, status: z.literal('canceled') }),
])

/** 取り消しの綴り（`cancelled`）だけ寄せる。klein と同じ扱い。 */
const normalizeCancelledSpelling = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  return record.status === 'cancelled' ? { ...record, status: 'canceled' } : value
}

export const AceStepJob = z.preprocess(normalizeCancelledSpelling, jobShape)
export type AceStepJob = z.infer<typeof jobShape>

export const AceStepSubmitResponse = z.object({ id: LocalServerJobId })
