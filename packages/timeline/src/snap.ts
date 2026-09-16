import {
  expandBeatGrid,
  shotEndSec,
  type BeatSubdivision,
  type MusicSection,
  type Seconds,
  type Shot,
  type ShotId,
  type TimelineClip,
  type TimelineClipId,
} from '@ixa/domain'
import { TIME_EPSILON } from './ordering.js'

/**
 * タイムライン編集の吸着（スナップ）。**純粋関数のみ。** IO も乱数も時計も使わない。
 *
 * ドラッグ中の時刻を、ビートや他の要素の端へ寄せる。
 * ビートグリッドの展開は再実装せず `@ixa/domain` の `expandBeatGrid` を使う。
 *
 * `Transition` は 2 つの Shot の間にあり自分の時刻を持たない（`domain/timeline.ts`）ため、
 * その端は `shot_edge` の候補として現れる。Transition 専用の候補種別は作らない。
 */

/** 何に吸着したか。画面で理由を出すために種別を持たせる。 */
export type SnapTargetKind =
  | 'shot_edge'
  | 'origin'
  | 'end'
  | 'clip_edge'
  | 'section'
  | 'drop'
  | 'beat'

export type SnapCandidate = {
  readonly atSec: Seconds
  readonly kind: SnapTargetKind
}

/**
 * 吸着の結果。
 *
 * `snappedTo` が `null` のときだけ「吸着しなかった」を意味する。
 * **`atSec` が入力と同じ値でも、吸着した結果そうなった場合がある。**
 * 値だけを見て「吸着しなかった」と判断しないこと（tasks/lessons.md L-015）。
 */
export type SnapResult = {
  readonly atSec: Seconds
  readonly snappedTo: SnapCandidate | null
}

/**
 * 候補を集めるための材料。省略した配列は「その種別の候補が無い」として扱う。
 *
 * `excludeShotId` / `excludeClipId` は**ドラッグ中の要素自身**を指定する。
 * 自分の端は距離 0 の候補になり、必ずそこへ吸着してしまって動かせなくなるため。
 */
export type SnapContext = {
  readonly beats?: readonly Seconds[]
  readonly subdivision?: BeatSubdivision
  readonly shots?: readonly Shot[]
  readonly clips?: readonly TimelineClip[]
  readonly sections?: readonly MusicSection[]
  readonly drops?: readonly Seconds[]
  /** タイムライン終端。楽曲の尺で決まる。0 のときは原点と重なるので原点が残る。 */
  readonly timelineEndSec?: Seconds
  readonly excludeShotId?: ShotId | null
  readonly excludeClipId?: TimelineClipId | null
}

/**
 * 同じ距離に複数の候補があるときの優先順位。**先にあるものが勝つ。**
 *
 * - `shot_edge` が最優先。VIDEO1 は Shot の投影なので、Shot の間に隙間ができると
 *   そこがそのまま**黒画面**になる。ビートに合っていても隙間は事故なので、
 *   隣の Shot の端に合わせることを常に優先する。
 * - `origin` / `end` はタイムラインの両端。先頭・末尾に隙間を残すのも同じ事故なので
 *   `shot_edge` に次いで強い。ただし Shot 同士を繋ぐほうが優先度は高い。
 * - `clip_edge` は TEXT / SFX / VFX の端。揃っていないと見た目が悪いが、
 *   黒画面ほど致命的ではないので構造的な境界の次。
 * - `section` は楽曲の構造。編集意図としては強いが、絵の連続性より後。
 * - `drop` はセクション内の単発のアクセント。構造ほど強くない。
 * - `beat` が最後。候補数が圧倒的に多く常に近くにあるため、同距離で優先すると
 *   他のすべての候補がビートに埋もれて一つも選ばれなくなる。
 */
const SNAP_PRIORITY: readonly SnapTargetKind[] = [
  'shot_edge',
  'origin',
  'end',
  'clip_edge',
  'section',
  'drop',
  'beat',
]

const priorityRank = (kind: SnapTargetKind): number => SNAP_PRIORITY.indexOf(kind)

/**
 * 吸着の既定の許容距離（画面上のピクセル）。
 * 数 px のマウスの揺れを吸収しつつ、意図して外した位置まで引き寄せない幅。
 */
export const DEFAULT_SNAP_THRESHOLD_PX = 8

/**
 * ズーム率（1 秒あたりのピクセル数）から許容距離を秒へ変換する。
 *
 * 許容距離を秒で固定すると、拡大時は勝手に吸着して細かく置けず、
 * 縮小時は狙っても吸着しない。**画面上の距離で一定**にするのが正しい。
 *
 * @throws pixelsPerSecond / thresholdPx が正の有限数でない場合。
 */
export const snapToleranceSecForZoom = (
  pixelsPerSecond: number,
  thresholdPx: number = DEFAULT_SNAP_THRESHOLD_PX,
): number => {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
    throw new RangeError(
      `pixelsPerSecond は正の有限数である必要があります: ${String(pixelsPerSecond)}`,
    )
  }
  if (!Number.isFinite(thresholdPx) || thresholdPx <= 0) {
    throw new RangeError(`thresholdPx は正の有限数である必要があります: ${String(thresholdPx)}`)
  }
  return thresholdPx / pixelsPerSecond
}

/**
 * 同じ時刻（TIME_EPSILON 以内）の候補を 1 つにまとめる。
 * まとめるときは**優先度の高い種別を残す**。理由の表示が「ビート」に化けないようにするため。
 */
const dedupeByTime = (candidates: readonly SnapCandidate[]): SnapCandidate[] => {
  const sorted = [...candidates].sort((a, b) => {
    const byTime = a.atSec - b.atSec
    if (byTime !== 0) return byTime
    return priorityRank(a.kind) - priorityRank(b.kind)
  })

  const result: SnapCandidate[] = []
  let cluster: SnapCandidate | undefined

  for (const candidate of sorted) {
    if (cluster !== undefined && Math.abs(candidate.atSec - cluster.atSec) <= TIME_EPSILON) {
      if (priorityRank(candidate.kind) < priorityRank(cluster.kind)) cluster = candidate
      continue
    }
    if (cluster !== undefined) result.push(cluster)
    cluster = candidate
  }
  if (cluster !== undefined) result.push(cluster)

  return result
}

/**
 * 吸着候補を集める。結果は `atSec` 昇順で、同時刻の候補は 1 つにまとめられている。
 *
 * ドラッグのたびに呼ばず、**ドラッグ開始時に 1 度だけ**呼ぶことを想定している。
 * 入力は一切変更しない。
 */
export const collectSnapCandidates = (context: SnapContext): readonly SnapCandidate[] => {
  const {
    beats = [],
    subdivision = 1,
    shots = [],
    clips = [],
    sections = [],
    drops = [],
    timelineEndSec = 0,
    excludeShotId = null,
    excludeClipId = null,
  } = context

  const candidates: SnapCandidate[] = [
    { atSec: 0, kind: 'origin' },
    { atSec: timelineEndSec, kind: 'end' },
  ]

  for (const shot of shots) {
    if (shot.id === excludeShotId) continue
    candidates.push({ atSec: shot.startSec, kind: 'shot_edge' })
    candidates.push({ atSec: shotEndSec(shot), kind: 'shot_edge' })
  }

  for (const clip of clips) {
    if (clip.id === excludeClipId) continue
    candidates.push({ atSec: clip.startSec, kind: 'clip_edge' })
    candidates.push({ atSec: clip.startSec + clip.durationSec, kind: 'clip_edge' })
  }

  for (const section of sections) {
    candidates.push({ atSec: section.start, kind: 'section' })
    candidates.push({ atSec: section.end, kind: 'section' })
  }

  for (const drop of drops) candidates.push({ atSec: drop, kind: 'drop' })

  for (const beat of expandBeatGrid(beats, subdivision)) {
    candidates.push({ atSec: beat, kind: 'beat' })
  }

  return dedupeByTime(candidates)
}

/**
 * `timeSec` を許容距離内で最も近い候補へ寄せる。候補が無ければ入力をそのまま返す。
 *
 * - 許容距離は**ちょうど境界の候補を含む**（`<=`）。float の丸め誤差で境界が
 *   すり抜けないよう `TIME_EPSILON` を足して比較する。
 * - 同距離のときは `SNAP_PRIORITY` の順で決める。
 * - **範囲の制限はしない。** 負の時刻や終端より後ろの時刻を渡しても、近くに候補が
 *   無ければそのまま返る。クランプは吸着とは別の責務（`validate.ts` 側の話）。
 * - `timeSec` や `toleranceSec` が非有限の場合はどの候補にも寄らず、入力をそのまま返す。
 *
 * 入力は一切変更しない。
 */
export const snapTime = (
  timeSec: Seconds,
  candidates: readonly SnapCandidate[],
  toleranceSec: number,
): SnapResult => {
  const noSnap: SnapResult = { atSec: timeSec, snappedTo: null }
  if (!Number.isFinite(timeSec)) return noSnap
  if (!Number.isFinite(toleranceSec) || toleranceSec < 0) return noSnap

  const limit = toleranceSec + TIME_EPSILON
  let best: SnapCandidate | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const distance = Math.abs(timeSec - candidate.atSec)
    if (!(distance <= limit)) continue

    if (best === undefined || distance < bestDistance - TIME_EPSILON) {
      best = candidate
      bestDistance = distance
      continue
    }
    // 同距離（TIME_EPSILON 以内）なら優先度で決める。
    if (
      Math.abs(distance - bestDistance) <= TIME_EPSILON &&
      priorityRank(candidate.kind) < priorityRank(best.kind)
    ) {
      best = candidate
      bestDistance = distance
    }
  }

  if (best === undefined) return noSnap
  return { atSec: best.atSec, snappedTo: best }
}
