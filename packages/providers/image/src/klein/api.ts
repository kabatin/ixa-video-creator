import { LocalServerJobError, LocalServerJobId, LocalServerJobTimings } from '@ixa/provider-video'
import { z } from 'zod'

/**
 * klein-api の応答（ADR-0047。契約の正は klein-api の `docs/api.md`）。
 *
 * 流れと失敗の封筒は vpipe-api v1 と同じだが、**出来上がりが複数枚の画像**なので
 * `result` の形だけが違う（動画の `LocalServerJob` は `result.output` 1 本を要求する）。
 * 未知のキーは落とし、形が違えば必ず失敗させる（pending へ丸めない）。
 */

/** 出来上がった 1 枚。`index` で `GET /v1/jobs/{id}/output?index=N` を引く。 */
export const KleinOutputInfo = z.object({
  index: z.number().int().nonnegative(),
  media_type: z.literal('image/png'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  seed_used: z.number().int().nonnegative().nullable(),
})
export type KleinOutputInfo = z.infer<typeof KleinOutputInfo>

export const KleinJobResult = z.object({
  outputs: z.array(KleinOutputInfo).min(1),
  seed_used: z.number().int().nonnegative().nullable(),
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
  z.object({ ...jobCommon, status: z.literal('succeeded'), result: KleinJobResult }),
  z.object({ ...jobCommon, status: z.literal('failed'), error: LocalServerJobError.nullable() }),
  z.object({ ...jobCommon, status: z.literal('canceled') }),
])

/** 取り消しの綴り（`cancelled`）だけ寄せる。動画の `LocalServerJob` と同じ扱い（ADR-0040）。 */
const normalizeCancelledSpelling = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  return record.status === 'cancelled' ? { ...record, status: 'canceled' } : value
}

export const KleinJob = z.preprocess(normalizeCancelledSpelling, jobShape)
export type KleinJob = z.infer<typeof jobShape>

export const KleinSubmitResponse = z.object({ id: LocalServerJobId })
