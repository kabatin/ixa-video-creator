import type { Shot } from './shot.js'

/**
 * Shot の分割と結合（制作者の要望 2026-09-26 / ADR-0024）。**IO を持たない規則だけ。**
 *
 * **Take の無い Shot だけを対象にする。** Take が付いた Shot を割ると Take がどちらのものかが
 * 決まらず、結合すると 2 つの Take の群れをどうまとめるかが決まらない。区切りから作った
 * 直後の下書きを直す用途に絞る。API（実行）と画面（押せるかの判定）の両方がここを使う。
 */

/** 分割・結合でできる Shot の最短の尺。区切りの最短（聴きながら切る）と揃える。 */
export const MIN_SHOT_EDIT_DURATION_SEC = 0.5

/** 隣り合っているとみなす誤差。秒の float を足し引きした結果の揺れを吸う。 */
const ADJACENT_EPSILON_SEC = 1e-6

/**
 * 分割・結合できない理由。触れるなら null。
 *
 * Take の有無は状態から読む（採用待ち・採用済みは Take がある）。API は Take の件数でも確かめる。
 */
export const shotEditBlocker = (shot: Pick<Shot, 'status' | 'lockedAt'>): string | null => {
  if (shot.lockedAt !== null) return 'ロックされています'
  if (shot.status === 'generating') return '生成中です'
  if (shot.status === 'review' || shot.status === 'approved') {
    return 'Take があります（Take の無い Shot だけ分割・結合できます）'
  }
  return null
}

export type SplitPlan =
  | {
      readonly ok: true
      /** 前半（元の Shot）の新しい尺。 */
      readonly firstDurationSec: number
      readonly secondStartSec: number
      readonly secondDurationSec: number
    }
  | { readonly ok: false; readonly reason: string }

/** `atSec`（タイムライン上の秒）で前後に割る。前半は元の Shot を縮め、後半を新しく作る。 */
export const planSplit = (
  shot: Pick<Shot, 'startSec' | 'durationSec' | 'status' | 'lockedAt'>,
  atSec: number,
): SplitPlan => {
  const blocker = shotEditBlocker(shot)
  if (blocker !== null) return { ok: false, reason: blocker }
  const endSec = shot.startSec + shot.durationSec
  if (atSec <= shot.startSec || atSec >= endSec) {
    return { ok: false, reason: '分割する位置が Shot の範囲にありません' }
  }
  const firstDurationSec = atSec - shot.startSec
  const secondDurationSec = endSec - atSec
  if (firstDurationSec < MIN_SHOT_EDIT_DURATION_SEC || secondDurationSec < MIN_SHOT_EDIT_DURATION_SEC) {
    return {
      ok: false,
      reason: `分けた片方が短すぎます（${String(MIN_SHOT_EDIT_DURATION_SEC)} 秒以上にしてください）`,
    }
  }
  return { ok: true, firstDurationSec, secondStartSec: atSec, secondDurationSec }
}

export type MergePlan =
  | {
      readonly ok: true
      /** 残す Shot（時間が最も早いもの）。内容はこれを残す。 */
      readonly keep: Shot
      /** 消す Shot。時間順。 */
      readonly remove: readonly Shot[]
      /** 残す Shot の新しい尺（先頭の始まりから最後の終わりまで）。 */
      readonly durationSec: number
    }
  | { readonly ok: false; readonly reason: string }

/**
 * 隣り合う Shot を先頭にまとめる。**飛び飛びはつながない**（間の Shot や隙間の中身が消える）。
 * Sequence が違う Shot もまとめない（どちらに入れるかが決まらない）。
 */
export const planMerge = (shots: readonly Shot[]): MergePlan => {
  if (shots.length < 2) return { ok: false, reason: '結合するには Shot を 2 件以上選んでください' }
  for (const shot of shots) {
    const blocker = shotEditBlocker(shot)
    if (blocker !== null) return { ok: false, reason: `${shot.code}: ${blocker}` }
  }
  const sorted = [...shots].sort((a, b) => a.startSec - b.startSec)
  const [keep, ...remove] = sorted
  if (keep === undefined) return { ok: false, reason: '結合する Shot がありません' }
  if (sorted.some((shot) => shot.sequenceId !== keep.sequenceId)) {
    return { ok: false, reason: 'Sequence が違う Shot は結合できません' }
  }
  const gap = sorted.slice(1).find((shot, index) => {
    const previous = sorted[index] as Shot
    return Math.abs(previous.startSec + previous.durationSec - shot.startSec) > ADJACENT_EPSILON_SEC
  })
  if (gap !== undefined) {
    return { ok: false, reason: `${gap.code} が前の Shot と隣り合っていません（間の Shot も選んでください）` }
  }
  const last = sorted[sorted.length - 1] as Shot
  return { ok: true, keep, remove, durationSec: last.startSec + last.durationSec - keep.startSec }
}

const SUFFIXES = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * 割った後半のコード。`CUT-02` → `CUT-02B`。**元が分かる名前にする。**
 * 空き番号（CUT-06 など）にすると、CUT-02 と CUT-03 の間に CUT-06 が並んで読み違える。
 */
export const splitShotCode = (code: string, usedCodes: ReadonlySet<string>): string => {
  const free = [...SUFFIXES].map((suffix) => `${code}${suffix}`).find((candidate) => !usedCodes.has(candidate))
  if (free !== undefined) return free
  let index = 2
  while (usedCodes.has(`${code}-${String(index)}`)) index += 1
  return `${code}-${String(index)}`
}
