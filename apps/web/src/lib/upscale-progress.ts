import { formatApproxDuration, formatElapsed } from '@/lib/format-time'
import type { WireActiveUpscale } from '@/lib/upscale-activity-api'

/**
 * 超解像の待ち・作成中を一覧の 1 語にする（制作者 2026-10-19）。**React を含まない。**
 * 経過は生成先へ送ってから。見込みはサーバの値（分からなければ言わない）。
 */
export const describeActiveUpscale = (upscale: WireActiveUpscale, nowMs: number): string => {
  if (upscale.status === 'queued' || upscale.startedAt === null) return '超解像待ち'
  const elapsed = formatElapsed((nowMs - Date.parse(upscale.startedAt)) / 1000)
  return upscale.estimateSeconds === null
    ? `超解像中 ${elapsed}`
    : `超解像中 ${elapsed} / ${formatApproxDuration(upscale.estimateSeconds)}`
}
