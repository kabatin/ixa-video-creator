import type { Take } from '@ixa/domain'
import { formatSeconds, formatUsd } from '@/lib/shot-display'

/**
 * Take がどこから来たかの言葉（ADR-0026）。
 *
 * 持ち込んだ Take はアプリの外で作った。モデル名・費用・生成時間を生成した Take と同じ言葉で
 * 出すと「$0.000・0.00s」と読め、無料で一瞬に作れたように見える。**分からないことは分からないと言う。**
 */
type Shown = Pick<Take, 'modelId' | 'providerParams' | 'costUsd' | 'generationTimeSec'>

const isImported = (take: Pick<Take, 'providerParams'>): boolean => take.providerParams.kind === 'import'

export const takeModelLabel = (take: Pick<Take, 'modelId' | 'providerParams'>): string => {
  if (take.providerParams.kind !== 'import') return take.modelId
  const { sourceModel } = take.providerParams
  return sourceModel === null ? '持ち込み（モデル不明）' : `持ち込み: ${sourceModel}`
}

export const takeCostLabel = (take: Shown): string =>
  isImported(take) ? 'アプリの外' : formatUsd(take.costUsd)

export const takeTimeLabel = (take: Shown): string =>
  isImported(take) ? '—' : formatSeconds(take.generationTimeSec)
