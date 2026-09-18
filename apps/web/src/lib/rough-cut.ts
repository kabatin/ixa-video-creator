import type { ShotId } from '@ixa/domain'
import type { RoughCutChange } from '@ixa/timeline'
import { formatClock, formatDuration } from '@/lib/format-time'
import type { WireRoughCutApplyResult, WireRoughCutPlan } from '@/lib/rough-cut-api'

/**
 * 粗編集の案を読める形に写す（P63-3）。**React を含まない純粋関数だけを置く。**
 *
 * ここでは**何も判定しない。** 何を直すかも、なぜ直すかも、決めたのはサーバの
 * `planRoughCut` で、この画面が触るのは並び順・見出し・秒の桁といった
 * 「ズレても壊れないもの」だけ（lessons L-016）。
 *
 * いちばん間違えやすいのは、案が 0 件のときに「きれいになりました」と読ませることだ。
 * 案が 0 件でも、機械が決められなかったものが残っていることがある。
 * **だから件数は必ず 2 つ並べて出す。**
 */

/** 色は役割の名前で持つ（PHASE 5.9）。素の色名は部品に書かない。 */
export type RoughCutTone = 'ok' | 'warn'

const KIND_LABELS: Readonly<Record<RoughCutChange['kind'], string>> = Object.freeze({
  move: '位置を動かす',
  trim: '尺を変える',
  select: 'Take を採用する',
})

export type RoughCutChangeView = {
  /** 画面のキーと、採否のチェック状態を引くための識別子。 */
  readonly key: string
  readonly shotId: ShotId
  readonly kindLabel: string
  /** どこからどこへ。位置は時計、尺は秒（`format-time.ts` の使い分けに従う）。 */
  readonly detail: string
  readonly reason: string
}

export type RoughCutUnresolvedView = {
  readonly key: string
  readonly shotId: ShotId
  readonly reason: string
}

export type RoughCutPlanView = {
  readonly changes: readonly RoughCutChangeView[]
  readonly unresolved: readonly RoughCutUnresolvedView[]
  /** 概要の 1 行。**案 0 件を「問題なし」と読ませない。** */
  readonly summary: string
  readonly tone: RoughCutTone
  readonly hasChanges: boolean
}

/** 案 1 件の識別子。同じ Shot に位置と尺の案が並ぶので、種別まで含める。 */
export const roughCutChangeKey = (change: RoughCutChange): string =>
  `${change.kind}:${change.shotId}`

const describeDetail = (change: RoughCutChange): string => {
  if (change.kind === 'move') {
    return `${formatClock(change.fromSec)} → ${formatClock(change.toSec)}`
  }
  if (change.kind === 'trim') {
    return `${formatDuration(change.fromDurationSec)} → ${formatDuration(change.toDurationSec)}`
  }
  return `Take ${change.takeId}`
}

const toChangeView = (change: RoughCutChange): RoughCutChangeView => ({
  key: roughCutChangeKey(change),
  shotId: change.shotId,
  kindLabel: KIND_LABELS[change.kind],
  detail: describeDetail(change),
  reason: change.reason,
})

/**
 * 概要の 1 行。**2 つの件数を必ず並べる。**
 *
 * 案だけを出すと、決められなかったものが画面から消えて「全部きれいになった」に化ける。
 * 空を返した先が「合格」に見える事故は実際に起きている（lessons L-015）。
 */
const describeSummary = (plan: WireRoughCutPlan): string => {
  const changes = plan.changes.length
  const unresolved = plan.unresolved.length

  if (changes === 0 && unresolved === 0) return '直すところはありませんでした'
  if (changes === 0) {
    return `機械が決められた案はありません。決められなかったものが ${unresolved.toString()} 件あります`
  }
  if (unresolved === 0) return `案が ${changes.toString()} 件あります`
  return `案が ${changes.toString()} 件、機械が決められなかったものが ${unresolved.toString()} 件あります`
}

export const buildRoughCutPlanView = (plan: WireRoughCutPlan): RoughCutPlanView => ({
  changes: plan.changes.map(toChangeView),
  unresolved: plan.unresolved.map((entry, index) => ({
    key: `unresolved:${entry.shotId}:${index.toString()}`,
    shotId: entry.shotId,
    reason: entry.reason,
  })),
  summary: describeSummary(plan),
  tone: plan.unresolved.length === 0 ? 'ok' : 'warn',
  hasChanges: plan.changes.length > 0,
})

export type RoughCutSkippedView = {
  readonly key: string
  readonly shotId: ShotId
  readonly kindLabel: string
  readonly detail: string
  readonly reason: string
}

export type RoughCutApplyView = {
  readonly summary: string
  readonly tone: RoughCutTone
  /** 当てられなかった分。**件数に畳まず、1 件ずつ理由を出す。** */
  readonly skipped: readonly RoughCutSkippedView[]
}

/**
 * 適用の結果を読める形に写す。
 *
 * **当てられなかった分を件数だけにしない。** 理由がなければ、人は
 * 「なぜこの Shot だけ動いていないのか」を自分で探すことになる。
 */
export const buildRoughCutApplyView = (result: WireRoughCutApplyResult): RoughCutApplyView => {
  const applied = result.applied.length
  const skipped = result.skipped.length

  return {
    summary:
      skipped === 0
        ? `${applied.toString()} 件を適用しました`
        : `${applied.toString()} 件を適用し、${skipped.toString()} 件は当てられませんでした`,
    tone: skipped === 0 ? 'ok' : 'warn',
    skipped: result.skipped.map((entry, index) => ({
      key: `skipped:${roughCutChangeKey(entry.change)}:${index.toString()}`,
      shotId: entry.change.shotId,
      kindLabel: KIND_LABELS[entry.change.kind],
      detail: describeDetail(entry.change),
      reason: entry.reason,
    })),
  }
}

/**
 * Shot の見出し。分かっていれば `code`、分からなければ ID をそのまま出す。
 * **省略しない。** 何の Shot か分からない案は採否を決められない。
 */
export const roughCutShotLabel = (
  shotId: ShotId,
  shotCodes?: ReadonlyMap<ShotId, string>,
): string => shotCodes?.get(shotId) ?? shotId
