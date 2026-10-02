import type { TimeSpan } from '@/lib/timeline-display'

/**
 * 端を動かすと、接している隣の端が付いてくる（制作者 2026-10-02「CUT4 の右側をつまんで右に移動したら CUT5 の先頭が
 * 後ろに追従して下がる感じ、逆もしかり、左側も同様」「テロップも同じですね」）。**React を含まない純粋な関数。**
 *
 * - 接している隣（差が 1 コマ未満）なら、隣の端も同じ所へ動く。隣が最小の尺になる所で止める
 * - 接していなければ、隣にぶつかる所で止める（重ならない）
 * - Option（Alt）なら隣は動かさない（隙間を空けたいとき）。そのときも隣にはぶつかって止まる
 *
 * テロップ（同じ帯・同じ段）とカット（VIDEO1）が同じ規則を通す。
 */

/** 接しているとみなす差。1 コマ（60fps で 0.0167 秒）に満たない差は端数（`@ixa/timeline` の Shot と同じ）。 */
export const ROLL_JOIN_TOLERANCE_SEC = 0.01

export type RollingItem = { readonly id: string; readonly span: TimeSpan }

/** 片側の隣。`adjacent` は接している相手、`blocking` は一番近い相手（ぶつかって止まる先）。 */
export type SideNeighbor = { readonly adjacent: RollingItem | null; readonly blocking: RollingItem | null }
export type EdgeNeighbors = { readonly before: SideNeighbor; readonly after: SideNeighbor }

const endOf = (span: TimeSpan): number => span.startSec + span.durationSec

/** 自分の前後の隣。重なっている相手は数えない（どちらの隣でもない）。 */
export const edgeNeighbors = (items: readonly RollingItem[], self: RollingItem): EdgeNeighbors => {
  const others = items.filter((item) => item.id !== self.id)
  const selfStart = self.span.startSec
  const selfEnd = endOf(self.span)
  const after = others
    .filter((item) => item.span.startSec >= selfEnd - ROLL_JOIN_TOLERANCE_SEC)
    .sort((a, b) => a.span.startSec - b.span.startSec)[0]
  const before = others
    .filter((item) => endOf(item.span) <= selfStart + ROLL_JOIN_TOLERANCE_SEC)
    .sort((a, b) => endOf(b.span) - endOf(a.span))[0]
  const touches = (gap: number): boolean => Math.abs(gap) <= ROLL_JOIN_TOLERANCE_SEC
  return {
    before: {
      adjacent: before !== undefined && touches(endOf(before.span) - selfStart) ? before : null,
      blocking: before ?? null,
    },
    after: {
      adjacent: after !== undefined && touches(after.span.startSec - selfEnd) ? after : null,
      blocking: after ?? null,
    },
  }
}

export type RolledEdge = {
  readonly span: TimeSpan
  /** 付いてきた隣の新しい区間。動かさないなら null。 */
  readonly neighbor: RollingItem | null
  /** 隣のせいで止めたときの理由。止めていなければ null。 */
  readonly limit: string | null
}

const EPSILON = 1e-6

/**
 * 掴んだ端（`start` / `end`）を動かした後の区間に、隣の規則をかける。本体（平行移動）には何もしない。
 * `span` は吸着・最小の尺をかけた後の自分の区間。
 */
export const rollEdge = (input: {
  readonly handle: 'start' | 'end' | 'body'
  readonly span: TimeSpan
  readonly neighbors: EdgeNeighbors
  readonly minNeighborSec: number
  /** 自分の最小の尺。隣の規則で縮めすぎないように使う。 */
  readonly minSelfSec?: number
  readonly detach: boolean
  /** 知らせに使う呼び名（テロップ・カット）。 */
  readonly noun: string
}): RolledEdge => {
  const { handle, span, neighbors, minNeighborSec, detach, noun } = input
  const minSelf = input.minSelfSec ?? 0
  const unchanged: RolledEdge = { span, neighbor: null, limit: null }
  if (handle === 'body') return unchanged
  const tooShortNeighbor = `隣の${noun}を ${minNeighborSec.toFixed(2)}s より短くできないので、ここで止めました`
  const bump = `隣の${noun}にぶつかるので、ここで止めました（重ねられません）`

  if (handle === 'end') {
    const end = endOf(span)
    const side = neighbors.after
    const adjacent = detach ? null : side.adjacent
    if (adjacent !== null) {
      const maxEnd = endOf(adjacent.span) - minNeighborSec
      const clamped = Math.max(Math.min(end, maxEnd), span.startSec + minSelf)
      return {
        span: { startSec: span.startSec, durationSec: clamped - span.startSec },
        neighbor: { id: adjacent.id, span: { startSec: clamped, durationSec: endOf(adjacent.span) - clamped } },
        limit: end > maxEnd + EPSILON ? tooShortNeighbor : null,
      }
    }
    if (side.blocking === null || end <= side.blocking.span.startSec + EPSILON) return unchanged
    const clamped = Math.max(side.blocking.span.startSec, span.startSec + minSelf)
    return { span: { startSec: span.startSec, durationSec: clamped - span.startSec }, neighbor: null, limit: bump }
  }

  const start = span.startSec
  const end = endOf(span)
  const side = neighbors.before
  const adjacent = detach ? null : side.adjacent
  if (adjacent !== null) {
    const minStart = adjacent.span.startSec + minNeighborSec
    const clamped = Math.min(Math.max(start, minStart), end - minSelf)
    return {
      span: { startSec: clamped, durationSec: end - clamped },
      neighbor: { id: adjacent.id, span: { startSec: adjacent.span.startSec, durationSec: clamped - adjacent.span.startSec } },
      limit: start < minStart - EPSILON ? tooShortNeighbor : null,
    }
  }
  if (side.blocking === null || start >= endOf(side.blocking.span) - EPSILON) return unchanged
  const clamped = Math.min(endOf(side.blocking.span), end - minSelf)
  return { span: { startSec: clamped, durationSec: end - clamped }, neighbor: null, limit: bump }
}

/** 付いてくる隣（接している相手）。吸着の候補から外す（その端は距離 0 で、吸い寄せると動かせない）。 */
export const adjacentIds = (neighbors: EdgeNeighbors): readonly string[] =>
  [neighbors.before.adjacent, neighbors.after.adjacent].flatMap((item) => (item === null ? [] : [item.id]))

export type RollingWrite = { readonly id: string; readonly from: TimeSpan; readonly to: TimeSpan }

/** 書く順。**縮む側を先に書く**（伸びる側を先に書くと、書き終えるまで一瞬重なる）。 */
export const shrinkFirst = <T extends RollingWrite>(writes: readonly T[]): readonly T[] =>
  [...writes].sort(
    (a, b) => a.to.durationSec - a.from.durationSec - (b.to.durationSec - b.from.durationSec),
  )

/** ドラッグ中に仮の位置で描く区間（自分と、付いてきた隣）。 */
export const previewSpans = (
  id: string,
  rolled: { readonly span: TimeSpan; readonly neighbor: RollingItem | null },
): ReadonlyMap<string, TimeSpan> =>
  new Map([[id, rolled.span], ...(rolled.neighbor === null ? [] : [[rolled.neighbor.id, rolled.neighbor.span] as const])])
