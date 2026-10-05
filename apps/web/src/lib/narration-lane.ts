/**
 * タイムラインのナレーションのレーン（ADR-0038）。**React を含まない。**
 * レーンは行の投影（Shot → 映像と同じ）。置いた行（位置がある）で、選んだ声の長さがある行だけを並べる。
 */

export type LaneLine = {
  readonly id: string
  readonly text: string
  readonly startSec: number | null
  readonly durationSec: number | null
  readonly voiceProfileId: string | null
  readonly selectedTakeId: string | null
  readonly takes: readonly { readonly id: string; readonly peaks: readonly number[] | null }[]
}

export type LaneBlock = {
  readonly lineId: string
  readonly label: string
  readonly startSec: number
  readonly durationSec: number
  /** 声ごとの色の番号（声の並び順。未定は 0）。 */
  readonly colorIndex: number
  readonly peaks: readonly number[]
}

export const laneBlocks = (lines: readonly LaneLine[], voiceIds: readonly string[]): readonly LaneBlock[] =>
  lines.flatMap((line) => {
    if (line.startSec === null || line.durationSec === null) return []
    const take = line.takes.find((candidate) => candidate.id === line.selectedTakeId)
    const index = line.voiceProfileId === null ? -1 : voiceIds.indexOf(line.voiceProfileId)
    return [
      {
        lineId: line.id,
        label: line.text,
        startSec: line.startSec,
        durationSec: line.durationSec,
        colorIndex: Math.max(index, 0),
        peaks: take?.peaks ?? [],
      },
    ]
  })

const round = (sec: number): number => Math.round(sec * 100) / 100

/** つかんで動かした位置（0.01 秒に丸め、0 より前には出さない）。 */
export const draggedStartSec = (originSec: number, dxPx: number, pxPerSec: number): number =>
  Math.max(0, round(originSec + dxPx / pxPerSec))

/** 矢印で動かした位置（0.1 秒、Shift で 1 秒）。矢印でなければ null。 */
export const nudgedStartSec = (startSec: number, key: string, coarse: boolean): number | null => {
  const step = coarse ? 1 : 0.1
  if (key === 'ArrowRight') return round(startSec + step)
  if (key === 'ArrowLeft') return Math.max(0, round(startSec - step))
  return null
}

/** 波形の点（0〜1）を、幅 × 高さの中の縦線の道（SVG の path）にする。真ん中から上下に伸ばす。 */
export const peaksPath = (peaks: readonly number[], widthPx: number, heightPx: number): string => {
  if (peaks.length === 0) return ''
  const step = widthPx / peaks.length
  const mid = heightPx / 2
  return peaks
    .map((peak, i) => {
      const x = round(step * (i + 0.5))
      const half = Math.max(0, Math.min(1, peak)) * mid
      return `M${String(x)} ${String(round(mid - half))}V${String(round(mid + half))}`
    })
    .join('')
}
