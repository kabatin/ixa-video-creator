import type { WireAnalysis } from '../wire.js'

/**
 * 楽曲解析を、エージェントが Shot 割りに使える大きさへ畳む。拍は数千、エネルギー曲線は数万の数になるので
 * そのままは渡さない。
 *
 * 実測では**セクション分割は当てにならず、拍は正確**（制作者メモ）。なので小節頭（downbeat）を主役に、
 * 4 小節ごとの区切り（フレーズ頭）とエネルギーの山を添える。
 */

export type EnergyPeak = { readonly atSec: number; readonly energy: number }

export type MusicSummary = {
  readonly durationSec: number
  readonly bpm: number
  readonly bpmConfidence: number
  readonly barSec: number | null
  readonly sections: readonly {
    readonly label: string
    readonly startSec: number
    readonly endSec: number
    readonly energy: number
  }[]
  readonly energyPeaks: readonly EnergyPeak[]
  readonly drops: readonly number[]
  readonly downbeatCount: number
  /** 4 小節ごとの頭。カットの候補として使いやすい粒度。 */
  readonly phraseStartsSec: readonly number[]
  /** 全部の小節頭（`includeDownbeats` のときだけ）。 */
  readonly downbeatsSec?: readonly number[]
}

const r2 = (value: number): number => Math.round(value * 100) / 100

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

const intervals = (times: readonly number[]): readonly number[] =>
  times.slice(1).map((t, i) => t - (times[i] as number))

/**
 * エネルギー曲線の山を、強い順に `count` 個。近すぎる山（`minGapSec` 以内）は強い方だけ残す。
 * 返すのは時刻順。
 */
export const energyPeaks = (
  curve: WireAnalysis['energyCurve'],
  count: number,
  minGapSec: number,
): readonly EnergyPeak[] => {
  const { values, hopSec } = curve
  const localMaxima = values.flatMap((value, i) => {
    const prev = values[i - 1] ?? Number.NEGATIVE_INFINITY
    const next = values[i + 1] ?? Number.NEGATIVE_INFINITY
    return value >= prev && value > next ? [{ atSec: i * hopSec, energy: value }] : []
  })
  const strongestFirst = [...localMaxima].sort((a, b) => b.energy - a.energy)
  const picked = strongestFirst.reduce<readonly EnergyPeak[]>(
    (kept, peak) =>
      kept.length >= count || kept.some((k) => Math.abs(k.atSec - peak.atSec) < minGapSec)
        ? kept
        : [...kept, peak],
    [],
  )
  return [...picked]
    .sort((a, b) => a.atSec - b.atSec)
    .map((peak) => ({ atSec: r2(peak.atSec), energy: r2(peak.energy) }))
}

export const PHRASE_BARS = 4
const PEAK_COUNT = 6
const PEAK_MIN_GAP_SEC = 4

export const summarizeAnalysis = (
  analysis: WireAnalysis,
  options: { readonly includeDownbeats: boolean },
): MusicSummary => {
  const barSec = median(intervals(analysis.downbeats))
  return {
    durationSec: r2(analysis.durationSec),
    bpm: Math.round(analysis.bpm * 10) / 10,
    bpmConfidence: r2(analysis.bpmConfidence),
    barSec: barSec === null ? null : Math.round(barSec * 1000) / 1000,
    sections: analysis.sections.map((s) => ({
      label: s.label,
      startSec: r2(s.start),
      endSec: r2(s.end),
      energy: r2(s.energy),
    })),
    energyPeaks: energyPeaks(analysis.energyCurve, PEAK_COUNT, PEAK_MIN_GAP_SEC),
    drops: analysis.drops.map(r2),
    downbeatCount: analysis.downbeats.length,
    phraseStartsSec: analysis.downbeats.filter((_t, i) => i % PHRASE_BARS === 0).map(r2),
    ...(options.includeDownbeats ? { downbeatsSec: analysis.downbeats.map(r2) } : {}),
  }
}
