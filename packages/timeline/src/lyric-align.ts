import { shotEndSec, type Seconds, type Shot, type ShotId } from '@ixa/domain'
import { roughCutLockedReason, type RoughCutChange } from './assemble.js'
import { sortShotsByStart, TIME_EPSILON } from './ordering.js'

/**
 * Shot の境目を歌い出しに揃える（制作者 2026-10-02「歌詞入れて再生してみると、かなり画像と歌詞がずれてる」）。
 * **純粋な関数のみ。**
 *
 * 区切ったのが歌詞に時刻を付ける前だったので、境目が歌い出しより中央値 1.95 秒・最大 4.6 秒早かった（ぼくははると）。
 * どの絵がどの歌詞に合うかは中身で決まるので、**揃える先は人が選ぶ**。ここは候補・既定・選んだ通りの変更を出す。
 * 変更は粗編集と同じ形（`RoughCutChange`）にし、当てるのは粗編集の適用（古さ・ロックの検査と変更の履歴がある）。
 */

/** 既定に選ぶ歌い出しの遠さの上限。実測のずれ（最大 4.6 秒）を収める。候補もこの範囲で出す。 */
export const LYRIC_ALIGN_MAX_SHIFT_SEC = 5

/** 揃えたあとの Shot の短さの下限。区切りの下限（web の `MIN_CUT_DURATION_SEC`）と同じ。 */
export const LYRIC_ALIGN_MIN_SHOT_SEC = 0.5

/**
 * 隣り合っているとみなす差。**1 コマ（60fps で 0.0167 秒）に満たない差**は端数として扱う。
 * 手で尺を伸ばすと端数が残った（ぼくははると: CUT-01 の終わりと CUT-02 の頭の差 0.00016 秒）。動かすときに閉じる。
 */
export const LYRIC_ALIGN_JOIN_TOLERANCE_SEC = 0.01

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

/** 動かせない理由。前後どちらかがロックなら動かさない（尺が変わる）。 */
const blockedReasonOf = (previous: Shot, shot: Shot): string | null => {
  if (previous.lockedAt !== null) return roughCutLockedReason(previous.code)
  if (shot.lockedAt !== null) return roughCutLockedReason(shot.code)
  const gap = shot.startSec - shotEndSec(previous)
  if (gap > LYRIC_ALIGN_JOIN_TOLERANCE_SEC) return `${previous.code} と ${shot.code} の間に隙間があるので動かしません`
  if (gap < -LYRIC_ALIGN_JOIN_TOLERANCE_SEC) return `${previous.code} と ${shot.code} が重なっているので動かしません`
  return null
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
    const blockedReason = blockedReasonOf(previous, shot)
    if (blockedReason !== null) return { ...base, choices: [], suggested: null, blockedReason }

    // 前の Shot の頭と、この Shot の終わりを越えない（どちらも下限の尺を残す）。
    const low = previous.startSec + LYRIC_ALIGN_MIN_SHOT_SEC
    const high = shotEndSec(shot) - LYRIC_ALIGN_MIN_SHOT_SEC
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

const secText = (value: number): string => `${value.toFixed(2)}s`

export type LyricAlignOutcome = {
  readonly changes: readonly RoughCutChange[]
  /** 当てられない理由（Shot がつぶれる・動かせない境目を選んだ）。当てられるなら null。 */
  readonly problem: string | null
}

/**
 * 選んだ揃える先（`Shot の頭 → 秒`）から、粗編集の変更を作る。後ろの Shot を動かし、前後の尺を変える。
 * 隣り合う境目なので**全体の尺は変わらない**。選んでいない・同じ秒の境目は何も出さない。
 */
export const lyricBoundaryChanges = (
  shots: readonly Shot[],
  chosen: ReadonlyMap<ShotId, Seconds>,
): LyricAlignOutcome => {
  const sorted = sortShotsByStart(shots)
  const blocked = new Map(
    sorted.slice(1).map((shot, position) => [shot.id, blockedReasonOf(sorted[position] as Shot, shot)] as const),
  )
  for (const shotId of chosen.keys()) {
    const reason = blocked.get(shotId)
    if (reason === undefined) return { changes: [], problem: '先頭の Shot の頭は動かせません' }
    if (reason !== null) return { changes: [], problem: reason }
  }

  const startOf = (shot: Shot): Seconds => chosen.get(shot.id) ?? shot.startSec
  const next = sorted.map((shot, index) => {
    const following = sorted[index + 1]
    // 次の Shot の頭を動かすときだけ、終わりをそこへ合わせる（1 コマ未満の端数もここで閉じる）。
    // 動かさない境目には触らない（端数だけの変更を出さない）。選べるのは隣り合う境目だけ（上で確かめた）。
    const movedNext = following === undefined ? undefined : chosen.get(following.id)
    const end = movedNext ?? shotEndSec(shot)
    return { shot, startSec: startOf(shot), durationSec: end - startOf(shot) }
  })

  const crushed = next.find((entry) => entry.durationSec < LYRIC_ALIGN_MIN_SHOT_SEC - TIME_EPSILON)
  if (crushed !== undefined) {
    return {
      changes: [],
      problem: `${crushed.shot.code} が ${secText(LYRIC_ALIGN_MIN_SHOT_SEC)} より短くなります。揃える先を選び直してください`,
    }
  }

  const changes = next.flatMap(({ shot, startSec, durationSec }): RoughCutChange[] => [
    ...(Math.abs(startSec - shot.startSec) > TIME_EPSILON
      ? [
          {
            kind: 'move' as const,
            shotId: shot.id,
            fromSec: shot.startSec,
            toSec: startSec,
            reason: `頭を歌い出し（${secText(startSec)}）に揃える`,
          },
        ]
      : []),
    ...(Math.abs(durationSec - shot.durationSec) > TIME_EPSILON
      ? [
          {
            kind: 'trim' as const,
            shotId: shot.id,
            fromDurationSec: shot.durationSec,
            toDurationSec: durationSec,
            reason: '境目を歌い出しに揃えたので尺が変わる',
          },
        ]
      : []),
  ])
  return { changes, problem: null }
}
