import { z } from 'zod'
import {
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  shotEndSec,
  snapToBeat,
  type Seconds,
  type Shot,
  type ShotId,
  type Take,
} from '@ixa/domain'
import type { TimelineSource } from './build.js'
import { TIME_EPSILON, sortShotsByStart } from './ordering.js'
import { TIMELINE_ISSUE_CODES, validateTimeline, type TimelineIssue } from './validate.js'

/**
 * 粗編集の自動組み立て（PHASE 6.3 / P63-3）。
 *
 * **組み立てるのではなく、組み立て方を提案する。** Undo がまだ無いので、
 * 黙って Shot を動かす関数は作らない。ここが返すのは案だけで、DB には触れない。
 *
 * 純粋関数のみ。IO も時計も乱数も使わず、入力を一切変更しない。
 *
 * 規則を書き写さない（lessons L-016）。
 * - 何が悪いかの定義は `validateTimeline` **だけ**が持つ
 * - 拍への吸着は `@ixa/domain` の `snapToBeat` **だけ**が持つ
 * - 時間の比較の許容誤差は `ordering.ts` の `TIME_EPSILON` **だけ**が持つ
 */

/**
 * 適用側（API）が `validateTimeline` と同じ許容誤差で
 * 「計画を作ったときから値が動いていないか」を見られるように再輸出する。
 * **別の定数を作らない。** ズレると、動いた Shot に古い案が当たる。
 */
export { TIME_EPSILON } from './ordering.js'

/** 繰り返しの上限。境目は左から順に閉じるので、本来 Shot 数を超えることはない。 */
const MAX_ROUNDS_MARGIN = 1

const sec = (value: number): string => `${value.toFixed(3)}s`

const isSameTime = (a: number, b: number): boolean => Math.abs(a - b) <= TIME_EPSILON

/** 採否の判断に要る列だけ。`@ixa/generation` には依存しない。 */
export type RoughCutTake = Pick<
  Take,
  'id' | 'shotId' | 'index' | 'reviewStatus' | 'humanVerdict' | 'createdAt'
>

export const RoughCutChange = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    shotId: ShotIdSchema,
    fromSec: z.number().finite().nonnegative(),
    toSec: z.number().finite().nonnegative(),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal('trim'),
    shotId: ShotIdSchema,
    fromDurationSec: z.number().finite().positive(),
    toDurationSec: z.number().finite().positive(),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal('select'),
    shotId: ShotIdSchema,
    takeId: TakeIdSchema,
    reason: z.string().min(1),
  }),
])
export type RoughCutChange = z.infer<typeof RoughCutChange>

/** 機械が決められなかったもの。**必ず理由を連れて来る。** */
export const RoughCutUnresolved = z.object({
  shotId: ShotIdSchema,
  reason: z.string().min(1),
})
export type RoughCutUnresolved = z.infer<typeof RoughCutUnresolved>

export const RoughCutPlan = z.object({
  changes: z.array(RoughCutChange),
  unresolved: z.array(RoughCutUnresolved),
})
export type RoughCutPlan = z.infer<typeof RoughCutPlan>

export type RoughCutInput = {
  /** `validateTimeline` に渡すのと同じ素材。指摘の定義を二重化しないため。 */
  readonly source: TimelineSource
  /**
   * 吸着に使う拍。**空配列は「拍が分かっていない」。**
   * そのときは拍に合わせたと書かない（lessons L-015）。
   */
  readonly beats: readonly Seconds[]
  /** Shot ごとの Take。載っていない Shot は 0 件として扱う。 */
  readonly takesByShot: ReadonlyMap<ShotId, readonly RoughCutTake[]>
}

/* ------------------------------------------------------------------ *
 * 採用 Take を決める
 * ------------------------------------------------------------------ */

/**
 * 自動採用の順位。**小さいほど強い。** 採用してはいけないものは null。
 *
 * 人が不採用にしたもの（`rejected`）と自動レビューが落としたもの（`failed`）は
 * 機械が拾い直さない。拾うと、人が落とした判断を機械が黙って覆すことになる。
 */
const adoptionRank = (take: RoughCutTake): number | null => {
  if (take.humanVerdict === 'rejected') return null
  if (take.reviewStatus === 'failed') return null
  if (take.humanVerdict === 'approved') return 0
  if (take.reviewStatus === 'passed') return 1
  if (take.reviewStatus === 'warned') return 2
  return 3
}

const ADOPTION_REASONS: Readonly<Record<number, string>> = {
  0: '人が承認した Take のうち最新',
  1: '自動レビューを通過した Take のうち最新',
  2: '自動レビューで警告が出ている Take のうち最新。内容を見てから決めること',
  3: 'まだレビューしていない Take のうち最新。レビュー前の採用になる',
}

/** 順位 → 新しい順（index 降順、同値なら作成が新しい順）で最良の 1 件。 */
const bestTake = (takes: readonly RoughCutTake[]): { take: RoughCutTake; rank: number } | null =>
  takes
    .flatMap((take) => {
      const rank = adoptionRank(take)
      return rank === null ? [] : [{ take, rank }]
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      if (a.take.index !== b.take.index) return b.take.index - a.take.index
      return b.take.createdAt.getTime() - a.take.createdAt.getTime()
    })[0] ?? null

/**
 * 採用 Take が無い Shot 1 件について、採用する Take を決める。
 *
 * **いま採用されている Take は候補から外す。** `shot_missing_take` は
 * 「採用 Take のメディアを解決できない」ときにも出る。同じ Take を提案し直すと、
 * 何も直っていないのに直ったように見える。
 */
const planSelect = (
  shot: Shot,
  takes: readonly RoughCutTake[],
  issue: TimelineIssue,
): { change: RoughCutChange } | { unresolved: RoughCutUnresolved } => {
  if (takes.length === 0) {
    return {
      unresolved: {
        shotId: shot.id,
        reason: `${issue.message}。Take が 1 件も無いので、採用する Take を機械には決められない`,
      },
    }
  }

  const candidates = takes.filter((take) => take.id !== shot.selectedTakeId)
  if (candidates.length === 0) {
    return {
      unresolved: {
        shotId: shot.id,
        reason:
          `${issue.message}。採用中の Take 以外に候補が無い` +
          `（採用中の Take のメディアを解決できていない可能性がある）`,
      },
    }
  }

  const best = bestTake(candidates)
  if (best === null) {
    return {
      unresolved: {
        shotId: shot.id,
        reason:
          `${issue.message}。候補 ${String(candidates.length)} 件はすべて` +
          `不採用または自動レビュー失敗で、機械が拾い直してよいものが無い`,
      },
    }
  }

  return {
    change: {
      kind: 'select',
      shotId: shot.id,
      takeId: best.take.id,
      reason: `${issue.message}。${ADOPTION_REASONS[best.rank] ?? ''}（#${String(best.take.index)}）`,
    },
  }
}

/* ------------------------------------------------------------------ *
 * 隙間と重なりを閉じる
 * ------------------------------------------------------------------ */

/** 直す対象の境目。`earlier` の終わりと `later` の始まりが食い違っている。 */
type Boundary = { readonly earlier: Shot; readonly later: Shot; readonly issue: TimelineIssue }

const boundaryKey = (boundary: Boundary): string => `${boundary.earlier.id}>${boundary.later.id}`

const TIMING_CODES: readonly string[] = [
  TIMELINE_ISSUE_CODES.shotGap,
  TIMELINE_ISSUE_CODES.shotOverlap,
]

/**
 * 指摘を境目に読み替える。**指摘そのものは作らない。**
 * `validateTimeline` が出した `shotId` の次の Shot が相手になる。
 */
const toBoundaries = (issues: readonly TimelineIssue[], shots: readonly Shot[]): Boundary[] => {
  const sorted = sortShotsByStart(shots)
  const indexById = new Map<ShotId, number>(sorted.map((shot, index) => [shot.id, index]))

  return issues.flatMap((issue): Boundary[] => {
    if (!TIMING_CODES.includes(issue.code)) return []
    if (issue.shotId === undefined) return []
    const index = indexById.get(issue.shotId)
    if (index === undefined) return []
    const earlier = sorted[index]
    const later = sorted[index + 1]
    if (earlier === undefined || later === undefined) return []
    return [{ earlier, later, issue }]
  })
}

/** 境目を閉じる時刻の案。`snapped` が false なら拍を使えなかった。 */
type BoundaryFix =
  | { readonly ok: true; readonly atSec: number; readonly snapped: boolean }
  | { readonly ok: false; readonly reason: string }

/**
 * 境目をどこで閉じるかを決める。
 *
 * 既定は**後ろの Shot の開始を拍へ吸着した位置**。前の Shot の終わりではなく
 * 後ろの Shot の開始を動かすのは、拍との整列を見るのが Shot の開始だから（P63-1）。
 *
 * 拍へ寄せると前の Shot の尺が 0 以下になる場合は、拍を諦めて後ろの Shot の
 * 開始位置で閉じる。**諦めたことは理由に必ず書く。**
 */
const resolveBoundary = (boundary: Boundary, beats: readonly Seconds[]): BoundaryFix => {
  const { earlier, later } = boundary
  const snapped = beats.length === 0 ? null : snapToBeat(later.startSec, beats)

  // ロックされた Shot は動かさない。拍へ寄せるには後ろの Shot を動かす必要がある。
  const canMoveLater = later.lockedAt === null
  const candidates: readonly { atSec: number; snapped: boolean }[] =
    snapped === null || !canMoveLater
      ? [{ atSec: later.startSec, snapped: false }]
      : [
          { atSec: snapped, snapped: true },
          { atSec: later.startSec, snapped: false },
        ]

  for (const candidate of candidates) {
    if (candidate.atSec - earlier.startSec <= TIME_EPSILON) continue
    if (candidate.atSec < 0) continue
    // 前の Shot の尺を変えずに閉じられないなら、前の Shot がロックされていては無理。
    if (earlier.lockedAt !== null && !isSameTime(candidate.atSec, shotEndSec(earlier))) continue
    return { ok: true, atSec: candidate.atSec, snapped: candidate.snapped }
  }

  if (earlier.lockedAt !== null) {
    return {
      ok: false,
      reason: `Shot ${earlier.code} がロックされているため、尺を変えて境目を閉じられない`,
    }
  }
  if (!canMoveLater) {
    return {
      ok: false,
      reason:
        `Shot ${later.code} がロックされていて動かせず、` +
        `その開始 ${sec(later.startSec)} は Shot ${earlier.code} の開始 ${sec(earlier.startSec)} より後ろにない`,
    }
  }
  return {
    ok: false,
    reason:
      `Shot ${later.code} の開始 ${sec(later.startSec)} が Shot ${earlier.code} の開始 ` +
      `${sec(earlier.startSec)} より後ろにないため、尺を 0 以下にしないと繋げない`,
  }
}

/** 拍を使えたか使えなかったかを、そのまま言葉にする（L-015）。 */
const describeAnchor = (
  fix: { atSec: number; snapped: boolean },
  boundary: Boundary,
  beats: readonly Seconds[],
): string => {
  if (fix.snapped) return `拍 ${sec(fix.atSec)} に合わせる`
  if (beats.length === 0) {
    return `拍が分かっていないため、Shot ${boundary.later.code} の開始 ${sec(fix.atSec)} に合わせる`
  }
  return (
    `拍へ寄せると Shot ${boundary.earlier.code} の尺が 0 以下になるため、拍を使わず ` +
    `Shot ${boundary.later.code} の開始 ${sec(fix.atSec)} に合わせる`
  )
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

/** Shot ごとに積み上げた理由。1 つの Shot が何度も触られることがある。 */
type ReasonLog = Map<ShotId, { move: string[]; trim: string[] }>

const addReason = (log: ReasonLog, shotId: ShotId, kind: 'move' | 'trim', reason: string): void => {
  const entry = log.get(shotId) ?? { move: [], trim: [] }
  if (!entry[kind].includes(reason)) entry[kind].push(reason)
  log.set(shotId, entry)
}

const issueKey = (issue: TimelineIssue): string => `${issue.code}:${issue.shotId ?? ''}`

/**
 * 隙間と重なりを左から順に 1 つずつ閉じる。
 *
 * 1 つ閉じるたびに `validateTimeline` を掛け直す。**自前で判定し直さない。**
 * 閉じた境目より後ろは動きうるので、直したつもりが新しい隙間を作っていないかを
 * 毎回同じ検査で確かめる。
 */
const closeBoundaries = (
  input: RoughCutInput,
): {
  readonly shots: readonly Shot[]
  readonly reasons: ReasonLog
  readonly unresolved: readonly RoughCutUnresolved[]
} => {
  const reasons: ReasonLog = new Map()
  const unresolved: RoughCutUnresolved[] = []
  const abandoned = new Set<string>()

  let shots: readonly Shot[] = input.source.shots
  const maxRounds = shots.length + MAX_ROUNDS_MARGIN

  for (let round = 0; round <= maxRounds; round += 1) {
    const issues = validateTimeline({ ...input.source, shots })
    const pending = toBoundaries(issues, shots)
      .filter((boundary) => !abandoned.has(boundaryKey(boundary)))
      .sort((a, b) => a.earlier.startSec - b.earlier.startSec)

    const boundary = pending[0]
    if (boundary === undefined) return { shots, reasons, unresolved }

    if (round === maxRounds) {
      // ここへ来るのは左から閉じる前提が崩れたとき。**黙って打ち切らない。**
      // 残っている境目を全部残す。1 件にまとめると何が未解決か分からなくなる（L-015）。
      for (const rest of pending) {
        unresolved.push({
          shotId: rest.earlier.id,
          reason: `${rest.issue.message}。繰り返しの上限に達しても解消しなかった`,
        })
      }
      return { shots, reasons, unresolved }
    }

    const fix = resolveBoundary(boundary, input.beats)
    if (!fix.ok) {
      abandoned.add(boundaryKey(boundary))
      unresolved.push({
        shotId: boundary.earlier.id,
        reason: `${boundary.issue.message}。${fix.reason}`,
      })
      continue
    }

    const anchor = describeAnchor(fix, boundary, input.beats)
    const { earlier, later } = boundary
    const nextDuration = fix.atSec - earlier.startSec

    if (!isSameTime(later.startSec, fix.atSec)) {
      addReason(reasons, later.id, 'move', `${boundary.issue.message}。${anchor}`)
    }
    if (!isSameTime(earlier.durationSec, nextDuration)) {
      const direction = nextDuration > earlier.durationSec ? '伸ばす' : '縮める'
      const note =
        nextDuration > earlier.durationSec
          ? '。生成尺が足りるかは機械には分からないので、伸ばした分は目で見ること'
          : ''
      addReason(
        reasons,
        earlier.id,
        'trim',
        `${boundary.issue.message}。${anchor}ため Shot ${earlier.code} の尺を${direction}${note}`,
      )
    }

    shots = shots.map((shot) => {
      if (shot.id === later.id) return { ...shot, startSec: fix.atSec }
      if (shot.id === earlier.id) return { ...shot, durationSec: nextDuration }
      return shot
    })
  }

  return { shots, reasons, unresolved }
}

/**
 * 粗編集の案を作る。**何も書かない。** 返るのは案と、決められなかったものだけ。
 *
 * 決められなかったものを黙って落とさない（lessons L-013 / L-015）。
 * 空の `unresolved` は「全部きれいになった」を意味するので、
 * 機械が判断を降りたものは必ず理由つきでここに残す。
 */
export const planRoughCut = (input: RoughCutInput): RoughCutPlan => {
  const original = input.source.shots
  const originalIssues = validateTimeline(input.source)
  const originalKeys = new Set(originalIssues.map(issueKey))

  const changes: RoughCutChange[] = []
  const unresolved: RoughCutUnresolved[] = []

  // 採用 Take は繰り返しの外で 1 度だけ決める。
  // 提案しただけでは `resolveShotMedia` の答えは変わらないので、
  // 繰り返しに混ぜると `shot_missing_take` が永久に消えない。
  const shotById = new Map<ShotId, Shot>(original.map((shot) => [shot.id, shot]))
  for (const issue of originalIssues) {
    if (issue.code !== TIMELINE_ISSUE_CODES.shotMissingTake) continue
    if (issue.shotId === undefined) continue
    const shot = shotById.get(issue.shotId)
    if (shot === undefined) continue
    const decided = planSelect(shot, input.takesByShot.get(shot.id) ?? [], issue)
    if ('change' in decided) changes.push(decided.change)
    else unresolved.push(decided.unresolved)
  }

  const closed = closeBoundaries(input)
  unresolved.push(...closed.unresolved)

  const proposedById = new Map<ShotId, Shot>(closed.shots.map((shot) => [shot.id, shot]))
  for (const shot of original) {
    const proposed = proposedById.get(shot.id)
    const log = closed.reasons.get(shot.id)
    if (proposed === undefined || log === undefined) continue

    if (!isSameTime(shot.startSec, proposed.startSec) && log.move.length > 0) {
      changes.push({
        kind: 'move',
        shotId: shot.id,
        fromSec: shot.startSec,
        toSec: proposed.startSec,
        reason: log.move.join(' / '),
      })
    }
    if (!isSameTime(shot.durationSec, proposed.durationSec) && log.trim.length > 0) {
      changes.push({
        kind: 'trim',
        shotId: shot.id,
        fromDurationSec: shot.durationSec,
        toDurationSec: proposed.durationSec,
        reason: log.trim.join(' / '),
      })
    }
  }

  /**
   * **この案が新しく作る指摘を黙って飲み込まない**（L-015）。
   * 尺を縮めれば Transition が長すぎになりうるし、クリップがはみ出しうる。
   * 判定は増やさず、同じ `validateTimeline` の結果を元の結果と突き合わせるだけ。
   */
  for (const issue of validateTimeline({ ...input.source, shots: closed.shots })) {
    if (originalKeys.has(issueKey(issue))) continue
    if (issue.shotId === undefined) continue
    if (TIMING_CODES.includes(issue.code)) continue
    unresolved.push({
      shotId: issue.shotId,
      reason: `この案を適用すると新しい指摘が出る: ${issue.message}`,
    })
  }

  return { changes, unresolved }
}
