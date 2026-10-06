import type { GenerationJob } from '@ixa/domain'
import type { ProviderJobStatus, VideoModelDescriptor } from '@ixa/provider-core'
import type { Logger } from 'pino'
import { z } from 'zod'

/**
 * 生成 1 本の実測を 1 行だけログに残す（ADR-0040）。
 *
 * MiniMax H3 と Wan 2.2 を後から**数字で**比べられるようにするための口。
 * 「draft で 5 秒の Shot が何分かかったか」「サーバの中で何秒待ったか」が分からないと、
 * AUTO にどちらを選ばせるかを決める材料が出てこない。
 *
 * **プロンプトの全文も画像も署名付き URL も入れない**（規約 7 / LESSONS）。
 * 入れるのは数字と識別子だけで、1 行に収める（あとで grep して並べられる形にする）。
 */

/** 完了の記録（`raw`）から、比べるのに要る数字だけを拾う。無ければ null（推測で埋めない）。 */
const BenchmarkFromRaw = z.object({
  quality: z.string().nullish(),
  output: z.object({ durationSec: z.number().nullish() }).nullish(),
  /** サーバの中で順番を待った秒数。 */
  queuedSec: z.number().nullish(),
  /** 生成そのものに掛かった秒数。 */
  renderSec: z.number().nullish(),
})

export type GenerationBenchmark = {
  readonly provider: string
  readonly modelId: string
  /** 生成の段（draft / standard）。分からなければ null。 */
  readonly qualityTier: string | null
  /** 頼んだ尺（秒）。 */
  readonly requestedDurationSec: number | null
  /** 積んでから終わるまで（順番待ちを含む全部）。 */
  readonly totalElapsedSec: number | null
  /** 生成先へ送ってから、生成先が作り始めるまで。 */
  readonly remoteQueuedSec: number | null
  /** 生成そのものに掛かった時間。 */
  readonly generationSec: number | null
  /** 出来た動画の尺（実測）。 */
  readonly outputDurationSec: number | null
  /** 失敗したときの種類（成功なら null）。 */
  readonly failureType: string | null
}

const secondsBetween = (from: Date | null, to: Date | null): number | null => {
  if (from === null || to === null) return null
  const ms = to.getTime() - from.getTime()
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null
}

const numberOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export type BenchmarkInput = {
  readonly job: GenerationJob
  readonly model: VideoModelDescriptor
  readonly requestedDurationSec: number | null
  readonly now: Date
  /** 成功したときの Provider の応答（`raw` から実測を拾う）。失敗なら省く。 */
  readonly status?: Extract<ProviderJobStatus, { state: 'succeeded' }>
  /** 失敗したときの種類（`provider_busy_timeout` / `wan_metal_oom` など）。 */
  readonly failureType?: string
}

export const generationBenchmarkOf = (input: BenchmarkInput): GenerationBenchmark => {
  const { job, model, status, now } = input
  const raw = status === undefined ? null : BenchmarkFromRaw.safeParse(status.raw)
  const picked = raw !== null && raw.success ? raw.data : null
  return {
    provider: model.providerId,
    modelId: model.id,
    qualityTier: picked?.quality ?? null,
    requestedDurationSec: numberOrNull(input.requestedDurationSec),
    totalElapsedSec: secondsBetween(job.queuedAt, now),
    // 生成先が報せた待ち時間を正とし、無ければこちらで測った「送ってから作り始めるまで」を使う。
    remoteQueuedSec:
      numberOrNull(picked?.queuedSec) ?? secondsBetween(job.startedAt, job.providerStartedAt),
    generationSec:
      numberOrNull(picked?.renderSec) ?? secondsBetween(job.providerStartedAt ?? job.startedAt, now),
    outputDurationSec: numberOrNull(picked?.output?.durationSec),
    failureType: input.failureType ?? null,
  }
}

/**
 * 実測を 1 行残す。**生成を止めない**（記録が書けないことで生成を失敗にしない）。
 * 成功も失敗も同じ形で残す（失敗だけ残らないと、失敗の多いモデルが速く見える）。
 */
export const logGenerationBenchmark = (
  logger: Logger,
  jobId: string,
  benchmark: GenerationBenchmark,
): void => {
  logger.info({ jobId, benchmark }, '生成の実測')
}
