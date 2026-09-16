import { shotEndSec, snapToBeat } from '@ixa/domain'
import type {
  BeatSubdivision,
  CreateReviewFindingInput,
  MusicAnalysis,
  Seconds,
  Severity,
  Shot,
} from '@ixa/domain'
import type { DeterministicReviewer, ReviewMeasurements } from './port.js'

/**
 * music レビュア（ADR-0005 Stage 1 / ARCHITECTURE.md §12）。
 * Shot の境界がビートに乗っているか、ドロップがカットと噛み合っているかを計算だけで判定する。
 *
 * **純粋関数。** IO も時計も乱数も使わない。
 * 楽曲解析が無いときは「判定できない」のであって「不合格」ではない。指摘を返さずに抜ける。
 */

/**
 * 判定に使うビートグリッドの分解能。
 * Shot 割り（ADR-0017 / `allocateShots`）は呼び出し側が選んだ subdivision で境界を決めるが、
 * その値は Shot にも測定値にも残らない。粗いグリッドで測ると 8 分・16 分のカットを
 * 誤って「ズレている」と判定してしまうため、最も細かい 16 分で測る。
 * ここで外れる境界は、どの分解能でもグリッドに乗っていないと言い切れる。
 */
export const MUSIC_GRID_SUBDIVISION: BeatSubdivision = 0.25

/**
 * ビートからのズレの許容誤差（秒）。
 * カットはフレーム境界にしか置けないので、24fps では最大で半フレーム = 0.021 秒ずれる。
 * これは避けようがない量なので許容し、かつ音ズレの知覚限界（40ms 前後）より内側に収める。
 */
export const BEAT_ALIGNMENT_TOLERANCE_SEC = 0.025

/**
 * ドロップが「カット上にある」とみなす距離（秒）。
 * ドロップ位置はオンセット検出の結果で、解析のホップ幅（librosa 既定で約 23ms）ぶんの
 * 粒度しか無い。その 2 ホップ分までは同じ位置とみなす。
 */
export const DROP_ON_CUT_TOLERANCE_SEC = 0.05

/**
 * グリッドを展開するのに最低限必要なビート数。
 * `expandBeatGrid` は拍間隔を分割するので、2 点無いと 16 分グリッドを作れない。
 */
export const MIN_BEATS_FOR_GRID = 2

const sec = (value: number): string => `${value.toFixed(2)}s`

type FindingDraft = {
  readonly severity: Severity
  readonly message: string
  readonly frameSec: Seconds | null
}

const finding = (draft: FindingDraft): CreateReviewFindingInput => ({
  reviewer: 'music',
  severity: draft.severity,
  // タイミングは合っているか外れているかの二値。連続値の score は付けない。
  score: null,
  message: draft.message,
  evidence: { frameSec: draft.frameSec, bbox: null, comparedAssetId: null },
  /**
   * タイミングのズレは編集（`startSec` / `durationSec` / `sourceInSec` の修正）で直す。
   * プロンプトを変えても直らないので常に null。再生成ループに無意味な差分を渡さない。
   */
  suggestedPromptDelta: null,
})

/**
 * タイムライン上の時刻を、この Take のメディア内の時刻へ移す。
 * `evidence.frameSec` は Take のフレームを指す値なので、タイムライン秒のまま入れない。
 */
const toMediaSec = (shot: Shot, timelineSec: Seconds): Seconds =>
  shot.sourceInSec + (timelineSec - shot.startSec)

/** グリッドの外側は寄せ先が無い。無理に最寄りへ寄せると巨大なズレが出るので判定しない。 */
const isWithinGrid = (timeSec: Seconds, beats: readonly Seconds[]): boolean => {
  const first = beats[0]
  const last = beats[beats.length - 1]
  if (first === undefined || last === undefined) return false
  return timeSec >= first && timeSec <= last
}

const checkBoundary = (
  label: string,
  timelineSec: Seconds,
  mediaSec: Seconds,
  beats: readonly Seconds[],
): readonly CreateReviewFindingInput[] => {
  if (!isWithinGrid(timelineSec, beats)) return []

  const nearest = snapToBeat(timelineSec, beats, MUSIC_GRID_SUBDIVISION)
  const offset = Math.abs(timelineSec - nearest)
  if (offset <= BEAT_ALIGNMENT_TOLERANCE_SEC) return []

  /**
   * 素材そのものは使えるので fail にしない。直し方は「編集で境界を動かす」であって
   * 再生成ではない。ここを fail にすると ADR-0005 の段取り上、意味の無い再生成を誘発する。
   */
  return [
    finding({
      severity: 'warn',
      message:
        `Shot の${label} ${sec(timelineSec)} がビートグリッドから ${sec(offset)} ズレている。` +
        `最も近いグリッド点は ${sec(nearest)}`,
      frameSec: mediaSec,
    }),
  ]
}

const checkDrops = (
  shot: Shot,
  analysis: MusicAnalysis,
): readonly CreateReviewFindingInput[] => {
  const startSec = shot.startSec
  const endSec = shotEndSec(shot)

  return [...analysis.drops]
    .sort((a, b) => a - b)
    .filter(
      (drop) =>
        drop > startSec + DROP_ON_CUT_TOLERANCE_SEC && drop < endSec - DROP_ON_CUT_TOLERANCE_SEC,
    )
    .map((drop) =>
      finding({
        severity: 'warn',
        message:
          `ドロップ ${sec(drop)} が Shot の途中にある（${sec(startSec)}〜${sec(endSec)}）。` +
          'ドロップでカットを割ること',
        frameSec: toMediaSec(shot, drop),
      }),
    )
}

export const musicReviewer: DeterministicReviewer = (
  measurements: ReviewMeasurements,
): readonly CreateReviewFindingInput[] => {
  const analysis = measurements.musicAnalysis
  // 未解析。判定できないことを fail にしない（ADR-0005 / 指示どおり skip）。
  if (analysis === null) return []

  const { beats } = analysis
  if (beats.length < MIN_BEATS_FOR_GRID) return []

  const { shot } = measurements
  const endSec = shotEndSec(shot)

  return [
    ...checkBoundary('開始', shot.startSec, shot.sourceInSec, beats),
    ...checkBoundary('終了', endSec, shot.sourceInSec + shot.durationSec, beats),
    ...checkDrops(shot, analysis),
  ]
}
