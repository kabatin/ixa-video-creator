import { shotEndSec, type Seconds, type Shot, type ShotId } from '@ixa/domain'
import { roughCutLockedReason, type RoughCutChange } from './assemble.js'
import { SHOT_JOIN_TOLERANCE_SEC, sortShotsByStart, TIME_EPSILON } from './ordering.js'

/**
 * Shot の境目・端を動かす変更を作る。**純粋な関数のみ。**
 *
 * 境目を歌い出しに揃える（2026-10-02）と、タイムラインの端のドラッグ（制作者 2026-10-02「カットの長さを、タイムラインの
 * カット部分の左右をドラッグで変えられるようにしたい。CUT4 の右側をつまんで右に移動したら CUT5 の先頭が後ろに追従して下がる」）
 * が同じ計算を通す。変更は粗編集と同じ形（`RoughCutChange`）にし、当てるのは粗編集の適用（古さ・ロックの検査と変更の履歴がある）。
 */

/** 動かしたあとの Shot の短さの下限。区切りの下限（web の `MIN_CUT_DURATION_SEC`）と同じ。 */
export const SHOT_MIN_DURATION_SEC = 0.5

/** 隣り合っているとみなす差（`ordering.ts`。書き出し前の検査と同じ幅）。動かすときに閉じる。 */
export { SHOT_JOIN_TOLERANCE_SEC }

/**
 * 1 つの Shot の長さを変えられない理由。ロック中・生成中なら変えない。
 * 生成中に尺を変えると、古い尺の Take が返ってくる（インスペクターも生成中は開始・尺を触らせない）。
 */
export const shotEditBlockedReason = (shot: Shot): string | null => {
  if (shot.lockedAt !== null) return roughCutLockedReason(shot.code)
  if (shot.status === 'generating') return `${shot.code} は生成中なので動かしません（終わってから動かしてください）`
  return null
}

/** 境目（`shot` の頭 = `previous` の終わり）を動かせない理由。前後どちらかが動かせないか、隣り合っていない。 */
export const shotBoundaryBlockedReason = (previous: Shot, shot: Shot): string | null => {
  const blocked = shotEditBlockedReason(previous) ?? shotEditBlockedReason(shot)
  if (blocked !== null) return blocked
  const gap = shot.startSec - shotEndSec(previous)
  if (gap > SHOT_JOIN_TOLERANCE_SEC) return `${previous.code} と ${shot.code} の間に隙間があるので動かしません`
  if (gap < -SHOT_JOIN_TOLERANCE_SEC) return `${previous.code} と ${shot.code} が重なっているので動かしません`
  return null
}

const secText = (value: number): string => `${value.toFixed(2)}s`

export type ShotBoundaryOutcome = {
  readonly changes: readonly RoughCutChange[]
  /** 当てられない理由（Shot がつぶれる・動かせない境目を選んだ）。当てられるなら null。 */
  readonly problem: string | null
}

/** 1 つの Shot を新しい区間にする変更。頭が変われば move、長さが変われば trim。 */
const changesFor = (shot: Shot, startSec: Seconds, durationSec: Seconds): RoughCutChange[] => [
  ...(Math.abs(startSec - shot.startSec) > TIME_EPSILON
    ? [
        {
          kind: 'move' as const,
          shotId: shot.id,
          fromSec: shot.startSec,
          toSec: startSec,
          reason: `頭を ${secText(startSec)} に動かす`,
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
          reason: '境目を動かしたので尺が変わる',
        },
      ]
    : []),
]

const tooShort = (shot: Shot): string =>
  `${shot.code} が ${secText(SHOT_MIN_DURATION_SEC)} より短くなります。動かす先を選び直してください`

/**
 * 境目を動かす変更（`Shot の頭 → 秒`）。後ろの Shot を動かし、前後の尺を変える。
 * 隣り合う境目なので**全体の尺は変わらない**。選んでいない・同じ秒の境目は何も出さない。
 */
export const shotBoundaryChanges = (
  shots: readonly Shot[],
  chosen: ReadonlyMap<ShotId, Seconds>,
): ShotBoundaryOutcome => {
  const sorted = sortShotsByStart(shots)
  const blocked = new Map(
    sorted.slice(1).map((shot, position) => [shot.id, shotBoundaryBlockedReason(sorted[position] as Shot, shot)] as const),
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

  const crushed = next.find((entry) => entry.durationSec < SHOT_MIN_DURATION_SEC - TIME_EPSILON)
  if (crushed !== undefined) return { changes: [], problem: tooShort(crushed.shot) }
  return {
    changes: next.flatMap(({ shot, startSec, durationSec }) => changesFor(shot, startSec, durationSec)),
    problem: null,
  }
}

/** 1 つの Shot の端だけを動かす変更（先頭の左端・最後の右端・隙間のある端）。隣は動かさない。 */
export const shotSpanChanges = (
  shot: Shot,
  span: { readonly startSec: Seconds; readonly durationSec: Seconds },
): ShotBoundaryOutcome => {
  const blocked = shotEditBlockedReason(shot)
  if (blocked !== null) return { changes: [], problem: blocked }
  if (span.durationSec < SHOT_MIN_DURATION_SEC - TIME_EPSILON) return { changes: [], problem: tooShort(shot) }
  return { changes: changesFor(shot, span.startSec, span.durationSec), problem: null }
}
