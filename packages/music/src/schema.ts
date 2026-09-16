import { MusicSection, Seconds } from '@ixa/domain'
import { z } from 'zod'

/**
 * `apps/audio` が返すワイヤ形式（snake_case）。
 * 外部境界なので必ず zod で検証してから内部へ通す（CLAUDE.md 規約 4）。
 */
export const AnalyzeResponseWire = z.object({
  analyzer_version: z.string().min(1),
  bpm: z.number().positive(),
  bpm_confidence: z.number().min(0).max(1),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  sections: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      label: z.string(),
      energy: z.number(),
    }),
  ),
  energy_curve: z.object({ hop_sec: z.number().positive(), values: z.array(z.number()) }),
  onsets: z.array(z.number()),
  drops: z.array(z.number()),
  duration_sec: z.number().nonnegative(),
  peaks: z.array(z.number()),
})
export type AnalyzeResponseWire = z.infer<typeof AnalyzeResponseWire>

/**
 * 解析結果（camelCase）。`MusicAnalysis`（`@ixa/domain`）のうち、
 * 解析器が決められる項目だけを持つ。id / musicTrackId / createdAt / waveformPeaksKey は
 * 永続化する側が付与する。
 */
export const MusicAnalysisResult = z.object({
  analyzerVersion: z.string().min(1),
  bpm: z.number().positive(),
  bpmConfidence: z.number().min(0).max(1),
  beats: z.array(Seconds),
  downbeats: z.array(Seconds),
  sections: z.array(MusicSection),
  energyCurve: z.object({ hopSec: z.number().positive(), values: z.array(z.number()) }),
  onsets: z.array(Seconds),
  drops: z.array(Seconds),
  durationSec: Seconds,
  /** UI 描画用の波形ピーク（0..1）。 */
  peaks: z.array(z.number().min(0).max(1)),
})
export type MusicAnalysisResult = z.infer<typeof MusicAnalysisResult>

/** ワイヤ形式を内部表現へ写す。snake_case → camelCase の変換はここだけで行う。 */
export const toMusicAnalysisResult = (wire: AnalyzeResponseWire): MusicAnalysisResult =>
  MusicAnalysisResult.parse({
    analyzerVersion: wire.analyzer_version,
    bpm: wire.bpm,
    bpmConfidence: wire.bpm_confidence,
    beats: wire.beats,
    downbeats: wire.downbeats,
    sections: wire.sections.map((section) => ({
      start: section.start,
      end: section.end,
      label: section.label,
      energy: section.energy,
    })),
    energyCurve: { hopSec: wire.energy_curve.hop_sec, values: wire.energy_curve.values },
    onsets: wire.onsets,
    drops: wire.drops,
    durationSec: wire.duration_sec,
    peaks: wire.peaks,
  })
