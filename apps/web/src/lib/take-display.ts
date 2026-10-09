import type { Take } from '@ixa/domain'
import { formatBytes } from '@/lib/format-bytes'
import { formatSeconds, formatUsd } from '@/lib/shot-display'

/** 画面に出す分だけの素材情報（`WireMediaInfo` と同じ形。型だけここで受ける）。 */
export type MediaInfo = {
  readonly bytes: number
  readonly probe: { readonly width: number | null; readonly height: number | null } | null
}

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

/**
 * 映像の大きさ（制作者 2026-10-09「Take 比較の情報に解像度とか容量も欲しい」）。
 *
 * **引けていない（`undefined`）と、測れていない（`probe` が null）を分ける。**
 * 前者は読み込み中で、待てば出る。後者は取り込みキューがまだ計測していないか、
 * 計測に失敗した状態で、待っても出ないことがある（ADR-0044 で実際に起きた）。
 */
export const takeResolutionLabel = (info: MediaInfo | undefined): string => {
  if (info === undefined) return '…'
  const width = info.probe?.width ?? null
  const height = info.probe?.height ?? null
  if (width === null || height === null) return '計測中'
  return `${String(width)}×${String(height)}`
}

/** ファイルの容量。**引けるまでは「…」**（0 B と読めると、壊れた Take に見える）。 */
export const takeBytesLabel = (info: MediaInfo | undefined): string =>
  info === undefined ? '…' : formatBytes(info.bytes)
