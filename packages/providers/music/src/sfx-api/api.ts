import { LocalServerJobError, LocalServerJobId, LocalServerJobTimings } from '@ixa/provider-video'
import { z } from 'zod'

/**
 * sfx-api の応答（ADR-0052 §1。契約は ixa 側で先に固め、サーバの `docs/api.md` ができたら突き合わせる）。
 *
 * 流れと失敗の封筒は ace-step-api と同じで、出来上がりの 1 本ごとに**標本化周波数**（`sample_rate`）・
 * チャンネル数（`channels`。MOSS はモノラル）・使った種を返すことだけが違う。未知のキーは落とし、形が違えば必ず失敗させる（pending へ丸めない）。
 */

/** 出来上がった 1 本。`index` で `GET /v1/jobs/{id}/output?index=N` を引く。 */
export const SfxApiOutputInfo = z.object({
  index: z.number().int().nonnegative(),
  media_type: z.literal('audio/wav'),
  /** 実際の長さ（秒）。頼んだ長さと少し違うことがある。 */
  duration_sec: z.number().positive(),
  sample_rate: z.number().int().positive(),
  /** 1（モノラル。MOSS）か 2（ステレオ。Stable Audio）。 */
  channels: z.number().int().min(1).max(2),
  /** この 1 本の種（i 本目は seed + 2i）。これを本数 1 で送ると同じ音が返る。 */
  seed_used: z.number().int().nonnegative().nullable(),
})
export type SfxApiOutputInfo = z.infer<typeof SfxApiOutputInfo>

export const SfxApiJobResult = z.object({
  outputs: z.array(SfxApiOutputInfo).min(1),
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
  z.object({ ...jobCommon, status: z.literal('succeeded'), result: SfxApiJobResult }),
  z.object({ ...jobCommon, status: z.literal('failed'), error: LocalServerJobError.nullable() }),
  z.object({ ...jobCommon, status: z.literal('canceled') }),
])

/** 取り消しの綴り（`cancelled`）だけ寄せる。ace-step と同じ扱い。 */
const normalizeCancelledSpelling = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  return record.status === 'cancelled' ? { ...record, status: 'canceled' } : value
}

export const SfxApiJob = z.preprocess(normalizeCancelledSpelling, jobShape)
export type SfxApiJob = z.infer<typeof jobShape>

export const SfxApiSubmitResponse = z.object({ id: LocalServerJobId })
