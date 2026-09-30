import { formatApproxDuration, formatElapsed } from '@/lib/format-time'
import type { WireActiveGeneration } from '@/lib/generation-activity-api'

/**
 * 生成中の様子を言葉にする（制作者 2026-09-30「生成中です、と出ているだけでわかりづらい」）。**React を含まない。**
 * どのモデルで・順番待ちか作成中か・どれだけ経ったか・目安はどれくらいか。分からないものは言わない（推し量らない）。
 */

export type ActiveGenerationView = {
  /** カードや一覧の 1 語（`作成中 2:31 / 約 4 分`）。 */
  readonly short: string
  /** インスペクターの 1 文。 */
  readonly long: string
  /** 目安を大きく過ぎている。 */
  readonly overdue: boolean
}

/** 目安の何倍を過ぎたら「大きく過ぎた」と言うか。目安は平均なので、少し過ぎただけでは騒がない。 */
const OVERDUE_FACTOR = 2

const secondsSince = (iso: string, nowMs: number): number => (nowMs - Date.parse(iso)) / 1000

export const describeActiveGeneration = (
  generation: WireActiveGeneration,
  nowMs: number,
): ActiveGenerationView => {
  const attempt = generation.attempt > 1 ? `${String(generation.attempt)} 回目の試みです。` : ''

  if (generation.status === 'queued') {
    const waited = formatElapsed(secondsSince(generation.queuedAt, nowMs))
    const model = generation.modelLabel === null ? '' : `${generation.modelLabel}で作ります。`
    return {
      short: `順番待ち ${waited}`,
      long: `順番待ちです（${waited}）。前の生成が終わるのを待っています。${model}${attempt}`,
      overdue: false,
    }
  }

  const elapsedSec = secondsSince(generation.startedAt ?? generation.queuedAt, nowMs)
  const elapsed = formatElapsed(elapsedSec)
  const typical = generation.typicalLatencySec
  const overdue = typical !== null && typical > 0 && elapsedSec > typical * OVERDUE_FACTOR
  const who = generation.modelLabel === null ? '作成中です' : `${generation.modelLabel}で作成中です`
  const detail =
    typical === null ? `経過 ${elapsed}` : `経過 ${elapsed} / 目安 ${formatApproxDuration(typical)}`
  return {
    short:
      typical === null
        ? `作成中 ${elapsed}`
        : `作成中 ${elapsed} / ${formatApproxDuration(typical)}`,
    long: `${who}（${detail}）。${attempt}${overdue ? '目安を大きく過ぎています。生成先が止まっていないか確かめてください。' : ''}`,
    overdue,
  }
}
