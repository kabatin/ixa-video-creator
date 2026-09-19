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
  /**
   * 音量の倍率。1 が原音。TimelineClip と同じ 0..2 の表現に揃える。
   * ミュージックビデオでは音楽と SFX のバランス調整が必須になるため列で持つ。
   */
  volume: z.number().min(0).max(2).default(1),
})
export type MusicTrack = z.infer<typeof MusicTrack>

export const CreateMusicTrackInput = MusicTrack.omit({ id: true })
export type CreateMusicTrackInput = z.input<typeof CreateMusicTrackInput>

/**
 * 楽曲の後から直せる項目（PHASE 8）。**マスターはここでは変えない**
 * （マスターは Project に 1 つだけなので、付け替えは別の操作 `setMaster` にする）。
 */
export const UpdateMusicTrackPatch = z
  .object({
    title: z.string().trim().min(1).optional(),
    offsetSec: Seconds.optional(),
    volume: z.number().min(0).max(2).optional(),
  })
  .strict()
export type UpdateMusicTrackPatch = z.infer<typeof UpdateMusicTrackPatch>

/**
 * 楽曲を 1 曲外したあと、どれをマスターにするか。**変えないなら null。**
 *
 * - 外したのがマスターでなければ変えない
 * - マスターを外したら、残りのうち**最初に登録した曲**（ULID の昇順）をマスターにする
 *   （登録時の「最初の 1 曲は必ずマスター」と同じ規則。マスターが 0 曲の Project を作らない）
 */
export const nextMasterAfterRemoval = (
  tracks: readonly Pick<MusicTrack, 'id' | 'isMaster'>[],
  removedId: MusicTrackId,
): MusicTrackId | null => {
  const removed = tracks.find((track) => track.id === removedId)
  if (removed === undefined || !removed.isMaster) return null
  const remaining = tracks
    .filter((track) => track.id !== removedId)
    .map((track) => track.id)
    .sort()
  return remaining[0] ?? null
}

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
  /** 解析対象の尺。セクションが尺全体を隙間なく覆うことの検証と、タイムライン配置に使う。 */
  durationSec: Seconds,
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

/**
 * 解析結果を 1 件保存するときの入力。id と createdAt はリポジトリが採番する。
 * **追記のみ。** 既存の解析を書き換える入力型は用意しない（再解析は新しい行を作る）。
 */
export const CreateMusicAnalysisInput = MusicAnalysis.omit({ id: true, createdAt: true })
export type CreateMusicAnalysisInput = z.input<typeof CreateMusicAnalysisInput>

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
