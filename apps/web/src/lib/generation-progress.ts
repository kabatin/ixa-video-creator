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

  // 送ったが、生成先がまだ作り始めていない（生成先の中で順番待ち。手元のサーバは 1 本ずつ作る。制作者 2026-10-04）。
  if (generation.providerStartedAt === null && generation.startedAt !== null) {
    const waited = formatElapsed(secondsSince(generation.startedAt, nowMs))
    const where = generation.modelLabel ?? '生成先'
    return {
      short: `生成先で順番待ち ${waited}`,
      long: `${where}に送り、順番を待っています（${waited}）。前の 1 本が終わると作り始めます。${attempt}`,
      overdue: false,
    }
  }

  // 経過は生成先が作り始めてから（待っていた時間で「目安を大きく過ぎた」と言わない）。
  const elapsedSec = secondsSince(generation.providerStartedAt ?? generation.startedAt ?? generation.queuedAt, nowMs)
  const elapsed = formatElapsed(elapsedSec)
  const estimate = generation.estimatedLatencySec
  const overdue = estimate !== null && estimate > 0 && elapsedSec > estimate * OVERDUE_FACTOR
  const who = generation.modelLabel === null ? '作成中です' : `${generation.modelLabel}で作成中です`
  const detail =
    estimate === null ? `経過 ${elapsed}` : `経過 ${elapsed} / 目安 ${formatApproxDuration(estimate)}`
  return {
    short:
      estimate === null
        ? `作成中 ${elapsed}`
        : `作成中 ${elapsed} / ${formatApproxDuration(estimate)}`,
    long: `${who}（${detail}）。${attempt}${overdue ? '目安を大きく過ぎています。生成先が止まっていないか確かめてください。' : ''}`,
    overdue,
  }
}
