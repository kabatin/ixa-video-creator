import { z } from 'zod'
import { MediaAssetId, MusicAnalysisId, MusicTrackId, ProjectId } from '../common/ids.js'
import { Seconds } from '../common/time.js'

export const MusicTrack = z.object({
  id: MusicTrackId,
  projectId: ProjectId,
  mediaAssetId: MediaAssetId,
  title: z.string(),
  isMaster: z.boolean().default(false),
  offsetSec: Seconds.default(0),
})
export type MusicTrack = z.infer<typeof MusicTrack>

export const SectionLabel = z.enum([
  'intro', 'verse', 'pre_chorus', 'chorus', 'bridge', 'break', 'drop', 'outro',
])
export type SectionLabel = z.infer<typeof SectionLabel>

export const MusicSection = z.object({
  start: Seconds,
  end: Seconds,
  label: SectionLabel,
  energy: z.number().min(0).max(1),
})
export type MusicSection = z.infer<typeof MusicSection>

export const MusicAnalysis = z.object({
  id: MusicAnalysisId,
  musicTrackId: MusicTrackId,
  /** 'librosa-v1' | 'manual' など。手動補正値は常に優先される（ADR-0009）。 */
  analyzerVersion: z.string().min(1),
  bpm: z.number().positive(),
  bpmConfidence: z.number().min(0).max(1),
  beats: z.array(Seconds),
  downbeats: z.array(Seconds),
  sections: z.array(MusicSection),
  energyCurve: z.object({ hopSec: z.number().positive(), values: z.array(z.number()) }),
  onsets: z.array(Seconds),
  drops: z.array(Seconds),
  waveformPeaksKey: z.string(),
  createdAt: z.date(),
})
export type MusicAnalysis = z.infer<typeof MusicAnalysis>

export const MANUAL_ANALYZER_VERSION = 'manual'

/** ビートグリッドの分解能。1 = 拍、0.5 = 8分、0.25 = 16分。 */
export type BeatSubdivision = 1 | 0.5 | 0.25

/** 最も近いビートへスナップする。Shot の尺は原則これを通す。 */
export const snapToBeat = (
  timeSec: Seconds,
  beats: readonly Seconds[],
  subdivision: BeatSubdivision = 1,
): Seconds => {
  if (beats.length === 0) return timeSec
  const grid = subdivision === 1 ? [...beats] : expandBeatGrid(beats, subdivision)
  let best = grid[0] as number
  let bestDist = Math.abs(timeSec - best)
  for (const candidate of grid) {
    const dist = Math.abs(timeSec - candidate)
    if (dist < bestDist) { best = candidate; bestDist = dist }
  }
  return best
}

export const expandBeatGrid = (
  beats: readonly Seconds[],
  subdivision: BeatSubdivision,
): Seconds[] => {
  if (subdivision === 1 || beats.length < 2) return [...beats]
  const divisions = Math.round(1 / subdivision)
  const grid: Seconds[] = []
  for (let i = 0; i + 1 < beats.length; i += 1) {
    const start = beats[i] as number
    const end = beats[i + 1] as number
    const step = (end - start) / divisions
    for (let d = 0; d < divisions; d += 1) grid.push(start + step * d)
  }
  grid.push(beats[beats.length - 1] as number)
  return grid
}
