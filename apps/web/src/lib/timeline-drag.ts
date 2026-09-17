import type { TimelineClipId } from '@ixa/domain'
import type { SnapCandidate } from '@ixa/timeline'
import {
  formatClock,
  formatTimeSpan,
  pxToSeconds,
  timeSpanToRect,
  type TimeSpan,
} from '@/lib/timeline-display'
import {
  buildSnapCandidates,
  snapSpan,
  type SnapNotice,
  type SnapSource,
} from '@/lib/timeline-snap'

/**
 * タイムラインのクリップを掴んで動かす計算。**React も DOM も含まない純粋関数だけ。**
 * 画素と秒の変換は `timeline-display` の `pxToSeconds` / `timeSpanToRect` が持ち、
 * 吸着の規則は `packages/timeline`（`timeline-snap` 経由）が持つ。ここがするのは
 * 「掴んだ場所はどこか」「引いた先はどこか」「なぜそこで止めたか」の 3 つだけで、
 * 変換式も吸着の規則も書き写さない（lessons L-016）。
 * 時間は常に秒（float）。入力は一切変更せず、常に新しい値を返す。
 */

// --- 掴める場所 ---

/** 端を掴める幅（画素）。**秒ではなく画素で決める**（`cut-editor-pointer` と同じ）。 */
export const EDGE_GRAB_WIDTH_PX = 6

/**
 * そのクリップで実際に端として扱う幅。**短いクリップでは固定幅が本体を食いつぶす。**
 * 幅 10px に左右 6px を取ると本体が残らず、掴めば必ず尺が変わる。一番よく使う操作
 * （平行移動）が消えるほうが、狭いクリップの尺を掴みにくいことより害が大きい。そこで
 * 端は**幅の 1/3 を超えない**。細かく変えたいなら寄って見ればよい。
 * **端の取っ手を描くときも必ずこの値を使うこと。** 描いた幅と掴める幅がずれると、
 * 見えているところを掴んでも何も起きない。
 */
export const edgeGrabWidthPx = (
  clipWidthPx: number,
  edgeGrabPx: number = EDGE_GRAB_WIDTH_PX,
): number => (clipWidthPx <= 0 ? 0 : Math.min(edgeGrabPx, clipWidthPx / 3))

export type ClipDragHandle = 'start' | 'end' | 'body'

const HANDLE_LABELS: Readonly<Record<ClipDragHandle, string>> = {
  start: '左端',
  end: '右端',
  body: '本体',
}

export const clipDragHandleLabel = (handle: ClipDragHandle): string => HANDLE_LABELS[handle]

/**
 * `left` は**時刻 0 が画面上のどこにあるか**（`clientX` と同じ座標系）。横スクロール中は
 * `rect.left - scrollLeft` を渡す。掴んだまま要素の外へ出ても同じ式で計算できる。
 */
export type TimelineBounds = { readonly left: number }

/**
 * ポインタの位置を秒へ。**丸めも制限もしない。** 0 秒より前を指したことは事実なので
 * 潰さず `applyClipDrag` が理由つきで止める。`pxPerSec` が正の有限数でないときだけ
 * 0（0 除算で NaN を配らないため）。
 */
export const timelineSecAtClientX = (
  clientX: number,
  bounds: TimelineBounds,
  pxPerSec: number,
): number => (pxPerSec > 0 ? pxToSeconds(clientX - bounds.left, pxPerSec) : 0)

/** その位置で掴めるもの。クリップの外なら null。幅は `timeSpanToRect` が決める。 */
export const clipHandleAtClientX = (
  span: TimeSpan,
  clientX: number,
  bounds: TimelineBounds,
  pxPerSec: number,
  edgeGrabPx: number = EDGE_GRAB_WIDTH_PX,
): ClipDragHandle | null => {
  if (!(pxPerSec > 0)) return null
  const rect = timeSpanToRect(span, pxPerSec)
  if (rect.widthPx <= 0) return null
  const x = clientX - bounds.left - rect.leftPx
  if (x < 0 || x > rect.widthPx) return null

  const edge = edgeGrabWidthPx(rect.widthPx, edgeGrabPx)
  if (x <= edge) return 'start'
  if (x >= rect.widthPx - edge) return 'end'
  return 'body'
}

/** 掴んだ瞬間。**掴んだ時刻を覚える**ので、端から 5px 内側を掴んでも飛ばない。 */
export type ClipDragStart = {
  readonly handle: ClipDragHandle
  readonly origin: TimeSpan
  readonly grabSec: number
}

export const beginClipDrag = (
  span: TimeSpan,
  clientX: number,
  bounds: TimelineBounds,
  pxPerSec: number,
  edgeGrabPx: number = EDGE_GRAB_WIDTH_PX,
): ClipDragStart | null => {
  const handle = clipHandleAtClientX(span, clientX, bounds, pxPerSec, edgeGrabPx)
  if (handle === null) return null
  return {
    handle,
    origin: { startSec: span.startSec, durationSec: span.durationSec },
    grabSec: timelineSecAtClientX(clientX, bounds, pxPerSec),
  }
}

/**
 * ドラッグ中のクリップ用の吸着候補。**当人を必ず候補から外す。** 外し忘れると自分の端が
 * 距離 0 の候補になり動かせなくなるので `clipId` を必須にしてある。ドラッグのたびに
 * 呼ばず、**掴んだときに 1 度だけ**呼ぶ（`packages/timeline/snap.ts`）。
 */
export const candidatesForClipDrag = (
  source: SnapSource,
  clipId: TimelineClipId,
): readonly SnapCandidate[] => buildSnapCandidates(source, { clipId })

// --- 止める理由 ---

/**
 * 最小の尺（秒）。30fps で 3 フレーム。これより短いテロップは読めず瞬きで消える。
 * 既定のズーム（40px/秒）で 4px・最大（160px/秒）で 16px あり、縮めきったクリップを
 * **もう一度掴み直せる**幅も残る。0 を許すと画面から消えて戻せなくなる。
 */
export const MIN_CLIP_DURATION_SEC = 0.1

/** 「動いた / 動かなかった」の判定に使う幅。表示のための丸めで、編集の規則ではない。 */
const DRAG_EPSILON_SEC = 0.0005

/**
 * 止めた事実として報告するか。**値は必ず合わせるが、報告はこの幅を越えたときだけ。**
 * 画素から秒に直すと端数が出る。ちょうど最小の尺に置いただけで「縮められません」と
 * 出ると、当たっていない壁に当たったように見える。
 */
const worthReporting = (shortfallSec: number): boolean => shortfallSec > DRAG_EPSILON_SEC

/**
 * 引いた先をそのまま使えなかった理由。**必ず返す。** 黙って値を丸めると「引いたのに
 * 動かない」としか見えず、直しようがない。
 * - `origin` — 0 秒より前へは置けないので止めた
 * - `min_duration` — 最小の尺に当たったので縮められなかった
 * - `past_end` — タイムラインの終端より後ろに出た（**止めてはいない**）
 */
export type ClipDragLimit =
  | { readonly kind: 'origin'; readonly message: string }
  | { readonly kind: 'min_duration'; readonly message: string }
  | { readonly kind: 'past_end'; readonly message: string }

const originLimit = (requestedSec: number): ClipDragLimit => ({
  kind: 'origin',
  message: `0 秒より前へは置けないので、開始を ${formatClock(0)} で止めました（${formatClock(requestedSec)} を指していました）`,
})

const minDurationLimit = (requestedSec: number, minDurationSec: number): ClipDragLimit => ({
  kind: 'min_duration',
  message: `尺は ${minDurationSec.toFixed(2)}s より短くできないので、${minDurationSec.toFixed(2)}s で止めました（${requestedSec.toFixed(2)}s まで縮めようとしました）`,
})

/**
 * 終端の扱い。**壁にしない。** 編集の途中では越えたほうが早いことがある（先に置いてから
 * 楽曲を差し替える、など）。越えたまま置けることと越えたと気づけることは両立するので
 * 止めずに理由だけ返す。書き出しでの扱いの判定は `validateTimeline` が持つ（L-016）。
 */
const pastEndLimit = (endSec: number, timelineEndSec: number): readonly ClipDragLimit[] => {
  if (!(timelineEndSec > 0) || !worthReporting(endSec - timelineEndSec)) return []
  return [
    {
      kind: 'past_end',
      message: `タイムラインの終端（${formatClock(timelineEndSec)}）を ${(endSec - timelineEndSec).toFixed(2)}s 越えています。位置は止めていないので、必要なら縮めてください`,
    },
  ]
}

export type ClipDragContext = {
  readonly candidates: readonly SnapCandidate[]
  readonly toleranceSec: number
  readonly snapEnabled: boolean
  readonly timelineEndSec: number
  readonly minDurationSec?: number
}

type EdgeSnap = {
  readonly startSec: number
  readonly endSec: number
  readonly startNotice: SnapNotice
  readonly endNotice: SnapNotice
}

/**
 * 開始と終了を候補へ寄せる。規則は `snapSpan` が持ち、ここは結果をほどくだけ。
 * **寄ったかは `state` で判定し、値の一致では判定しない**（L-015）。`snapSpan` は
 * 終了が寄らなければ尺を入力のまま返すので、そのときの終了は「引いた先」。
 */
const snapBothEdges = (span: TimeSpan, context: ClipDragContext): EdgeSnap => {
  const outcome = snapSpan(span, context.candidates, context.toleranceSec, context.snapEnabled)
  const [startNotice, endNotice] = outcome.notices
  if (startNotice === undefined || endNotice === undefined) {
    throw new Error('snapSpan が開始と終了の説明を返しませんでした')
  }
  return {
    startSec: outcome.startSec,
    endSec:
      endNotice.state === 'snapped'
        ? outcome.startSec + outcome.durationSec
        : span.startSec + span.durationSec,
    startNotice,
    endNotice,
  }
}

const translationRejected = (label: string, usedLabel: string): SnapNotice => ({
  state: 'rejected',
  label,
  message: `平行移動では尺を変えないため、${label}の吸着は見送りました（${usedLabel}のほうが近いのでそちらへ寄せています）`,
})

const endOf = (span: TimeSpan): number => span.startSec + span.durationSec

/** 掴んだ場所ごとの「引いた先」。掴んだ点からのずれで動かすので掴んだ瞬間に飛ばない。 */
const requestedSpanOf = (drag: ClipDragStart, deltaSec: number): TimeSpan => {
  switch (drag.handle) {
    case 'body':
      return { startSec: drag.origin.startSec + deltaSec, durationSec: drag.origin.durationSec }
    case 'start': {
      const startSec = drag.origin.startSec + deltaSec
      return { startSec, durationSec: endOf(drag.origin) - startSec }
    }
    case 'end':
      return { startSec: drag.origin.startSec, durationSec: drag.origin.durationSec + deltaSec }
  }
}

type Resolved = { readonly span: TimeSpan; readonly notices: readonly SnapNotice[] }

/**
 * 掴んだ場所ごとの約束を守った区間を組み直す。
 * - 本体 — 平行移動。**尺は変わらない。** 開始と終了のうち近いほうへ寄せ、
 *   使わなかったほうは見送った理由を残す
 * - 左端 — 開始だけ動く。**終了は動かさない**ので尺が変わる／右端はその逆
 */
const resolveBySpan = (drag: ClipDragStart, requested: TimeSpan, snapped: EdgeSnap): Resolved => {
  if (drag.handle === 'start') {
    return {
      span: { startSec: snapped.startSec, durationSec: endOf(drag.origin) - snapped.startSec },
      notices: [snapped.startNotice],
    }
  }
  if (drag.handle === 'end') {
    const durationSec = snapped.endSec - drag.origin.startSec
    return {
      span: { startSec: drag.origin.startSec, durationSec },
      notices: [snapped.endNotice],
    }
  }

  const fromStart =
    snapped.startNotice.state === 'snapped' ? snapped.startSec - requested.startSec : null
  const fromEnd = snapped.endNotice.state === 'snapped' ? snapped.endSec - endOf(requested) : null
  const useStart =
    fromStart !== null && (fromEnd === null || Math.abs(fromStart) <= Math.abs(fromEnd))
  const both = fromStart !== null && fromEnd !== null

  return {
    span: {
      startSec: requested.startSec + ((useStart ? fromStart : fromEnd) ?? 0),
      durationSec: drag.origin.durationSec,
    },
    notices: !both
      ? [snapped.startNotice, snapped.endNotice]
      : useStart
        ? [snapped.startNotice, translationRejected('終了', '開始')]
        : [translationRejected('開始', '終了'), snapped.endNotice],
  }
}

type Clamped = { readonly span: TimeSpan; readonly limits: readonly ClipDragLimit[] }

const clampSpan = (handle: ClipDragHandle, span: TimeSpan, minDurationSec: number): Clamped => {
  // 右端。開始は動かさないので、最小の尺が終了の下限として効く。
  if (handle === 'end') {
    return {
      span: { startSec: span.startSec, durationSec: Math.max(span.durationSec, minDurationSec) },
      limits: worthReporting(minDurationSec - span.durationSec)
        ? [minDurationLimit(span.durationSec, minDurationSec)]
        : [],
    }
  }

  // 本体。尺は動かさないので 0 秒の壁だけが効く。
  if (handle === 'body') {
    return {
      span: { startSec: Math.max(span.startSec, 0), durationSec: span.durationSec },
      limits: worthReporting(-span.startSec) ? [originLimit(span.startSec)] : [],
    }
  }

  // 左端。尺の下限が開始の上限として効く。**最小の尺より 0 秒のほうが強い**（負の時刻は無い）。
  const endSec = endOf(span)
  const afterMin = Math.min(span.startSec, endSec - minDurationSec)
  const startSec = Math.max(afterMin, 0)
  return {
    span: { startSec, durationSec: endSec - startSec },
    limits: [
      ...(worthReporting(minDurationSec - span.durationSec)
        ? [minDurationLimit(span.durationSec, minDurationSec)]
        : []),
      ...(worthReporting(-afterMin) ? [originLimit(afterMin)] : []),
    ],
  }
}

export type ClipDragOutcome = {
  readonly handle: ClipDragHandle
  readonly origin: TimeSpan
  /** 吸着も制限もかける前、ポインタが指した区間。断った理由を説明するために残す。 */
  readonly requested: TimeSpan
  readonly span: TimeSpan
  readonly moved: boolean
  readonly snapNotices: readonly SnapNotice[]
  readonly limits: readonly ClipDragLimit[]
}

/**
 * 掴んだまま動かした結果。**入力は一切変更せず、常に新しい値を返す。** 順番は「引いた先
 * → 吸着 → 制限」。制限を先にかけると吸着が押し戻す。止めたことは `limits` に必ず残す。
 */
export const applyClipDrag = (
  drag: ClipDragStart,
  clientX: number,
  bounds: TimelineBounds,
  pxPerSec: number,
  context: ClipDragContext,
): ClipDragOutcome => {
  const minDurationSec = context.minDurationSec ?? MIN_CLIP_DURATION_SEC
  const deltaSec = timelineSecAtClientX(clientX, bounds, pxPerSec) - drag.grabSec
  const requested = requestedSpanOf(drag, deltaSec)
  const resolved = resolveBySpan(drag, requested, snapBothEdges(requested, context))
  const clamped = clampSpan(drag.handle, resolved.span, minDurationSec)

  return {
    handle: drag.handle,
    origin: drag.origin,
    requested,
    span: clamped.span,
    moved:
      Math.abs(clamped.span.startSec - drag.origin.startSec) > DRAG_EPSILON_SEC ||
      Math.abs(clamped.span.durationSec - drag.origin.durationSec) > DRAG_EPSILON_SEC,
    snapNotices: resolved.notices,
    limits: [...clamped.limits, ...pastEndLimit(endOf(clamped.span), context.timelineEndSec)],
  }
}

const signedSec = (deltaSec: number): string => `${deltaSec > 0 ? '+' : ''}${deltaSec.toFixed(3)}s`

export type ClipDragSummary = {
  readonly headline: string
  readonly spanText: string
  readonly snapMessages: readonly string[]
  readonly limitMessages: readonly string[]
}

const movedHeadline = (outcome: ClipDragOutcome): string => {
  const { origin, span } = outcome
  switch (outcome.handle) {
    case 'body':
      return `位置を ${formatClock(origin.startSec)} → ${formatClock(span.startSec)} へ動かしました（${signedSec(span.startSec - origin.startSec)}）。尺 ${span.durationSec.toFixed(2)}s は変えていません`
    case 'start':
      return `開始を ${formatClock(origin.startSec)} → ${formatClock(span.startSec)} へ動かしました（${signedSec(span.startSec - origin.startSec)}）。終了 ${formatClock(endOf(span))} は動かしていません。尺 ${origin.durationSec.toFixed(2)}s → ${span.durationSec.toFixed(2)}s`
    case 'end':
      return `尺を ${origin.durationSec.toFixed(2)}s → ${span.durationSec.toFixed(2)}s へ変えました（${signedSec(span.durationSec - origin.durationSec)}）。開始 ${formatClock(origin.startSec)} は動かしていません`
  }
}

/**
 * 何がどれだけ動いたかを日本語にする。**動かなかったときも必ず理由を出す。** 制限で
 * 止めたのか、まだポインタが動いていないのかは画面上では同じに見える（L-015）。
 */
export const describeClipDrag = (outcome: ClipDragOutcome): ClipDragSummary => {
  const blocked = outcome.limits.find((limit) => limit.kind !== 'past_end')
  return {
    headline: outcome.moved
      ? movedHeadline(outcome)
      : blocked === undefined
        ? `${clipDragHandleLabel(outcome.handle)}を掴んでいます。まだ動いていません`
        : `${clipDragHandleLabel(outcome.handle)}は動かせませんでした。${blocked.message}`,
    spanText: formatTimeSpan(outcome.span),
    snapMessages: outcome.snapNotices.map((notice) => `${notice.label}: ${notice.message}`),
    limitMessages: outcome.limits.map((limit) => limit.message),
  }
}
