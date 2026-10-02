import { shotEndSec, type Seconds, type Shot, type ShotId } from '@ixa/domain'
import { sortShotsByStart, TIME_EPSILON } from './ordering.js'
import { SHOT_MIN_DURATION_SEC, shotBoundaryBlockedReason } from './shot-boundary.js'

/**
 * Shot の境目を歌い出しに揃える（制作者 2026-10-02「歌詞入れて再生してみると、かなり画像と歌詞がずれてる」）。
 * **純粋な関数のみ。**
 *
 * 区切ったのが歌詞に時刻を付ける前だったので、境目が歌い出しより中央値 1.95 秒・最大 4.6 秒早かった（ぼくははると）。
 * どの絵がどの歌詞に合うかは中身で決まるので、**揃える先は人が選ぶ**。ここは候補・既定・選んだ通りの変更を出す。
 * 選んだ先から変更を作るのは `shot-boundary.ts` の `shotBoundaryChanges`（タイムラインの端のドラッグと同じ計算）。
 */

/** 既定に選ぶ歌い出しの遠さの上限。実測のずれ（最大 4.6 秒）を収める。候補もこの範囲で出す。 */
export const LYRIC_ALIGN_MAX_SHIFT_SEC = 5

/** 歌い出し 1 つ。`index` は歌詞の行（`lyricLines`）の番号。 */
export type LyricCueRef = { readonly index: number; readonly atSec: Seconds }

/** 境目 1 つ。境目は `shotId` の Shot の頭（= 前の Shot の終わり）。 */
export type LyricBoundary = {
  readonly shotId: ShotId
  readonly previousShotId: ShotId
  readonly atSec: Seconds
  /** 動かせる先（前後の Shot をつぶさない・近い順ではなく時刻順）。動かせなければ空。 */
  readonly choices: readonly LyricCueRef[]
  /** 既定の揃える先（境目のすぐ後の歌い出し）。無ければ null（動かさない）。 */
  readonly suggested: LyricCueRef | null
  /** 動かせない理由（隙間・重なり・ロック）。動かせるなら null。 */
  readonly blockedReason: string | null
}

export const proposeLyricBoundaries = (
  shots: readonly Shot[],
  cues: readonly Seconds[],
): readonly LyricBoundary[] => {
  const sorted = sortShotsByStart(shots)
  const refs: readonly LyricCueRef[] = cues.map((atSec, index) => ({ index, atSec }))
  return sorted.slice(1).map((shot, position): LyricBoundary => {
    const previous = sorted[position] as Shot
    const base = { shotId: shot.id, previousShotId: previous.id, atSec: shot.startSec }
    const blockedReason = shotBoundaryBlockedReason(previous, shot)
    if (blockedReason !== null) return { ...base, choices: [], suggested: null, blockedReason }

    // 前の Shot の頭と、この Shot の終わりを越えない（どちらも下限の尺を残す）。
    const low = previous.startSec + SHOT_MIN_DURATION_SEC
    const high = shotEndSec(shot) - SHOT_MIN_DURATION_SEC
    const choices = refs.filter(
      (cue) =>
        cue.atSec >= low &&
        cue.atSec <= high &&
        Math.abs(cue.atSec - shot.startSec) <= LYRIC_ALIGN_MAX_SHIFT_SEC + TIME_EPSILON,
    )
    const suggested = choices.find((cue) => cue.atSec >= shot.startSec - TIME_EPSILON) ?? null
    return { ...base, choices, suggested, blockedReason: null }
  })
}
