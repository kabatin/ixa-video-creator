import type { Take } from '@ixa/domain'
import { formatSeconds, formatUsd } from '@/lib/shot-display'

/**
 * Take がどこから来たかの言葉（ADR-0026）。
 *
 * 持ち込んだ Take はアプリの外で作った。モデル名・費用・生成時間を生成した Take と同じ言葉で
 * 出すと「$0.000・0.00s」と読め、無料で一瞬に作れたように見える。**分からないことは分からないと言う。**
 */
type Shown = Pick<Take, 'modelId' | 'providerParams' | 'costUsd' | 'generationTimeSec' | 'copiedFromTakeId'>

const isImported = (take: Pick<Take, 'providerParams'>): boolean => take.providerParams.kind === 'import'

export const takeModelLabel = (take: Pick<Take, 'modelId' | 'providerParams'>): string => {
  if (take.providerParams.kind !== 'import') return take.modelId
  const { sourceModel } = take.providerParams
  return sourceModel === null ? '持ち込み（モデル不明）' : `持ち込み: ${sourceModel}`
}

/** 費用。作品の複製で写した Take は、払ったのが元の作品だと言う（この作品の費用には入らない）。 */
export const takeCostLabel = (take: Shown): string => {
  if (isImported(take)) return 'アプリの外'
  return take.copiedFromTakeId === null ? formatUsd(take.costUsd) : `元の作品で ${formatUsd(take.costUsd)}`
}

export const takeTimeLabel = (take: Shown): string =>
  isImported(take) ? '—' : formatSeconds(take.generationTimeSec)
