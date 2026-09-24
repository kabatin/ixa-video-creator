import {
  BeatAlignment,
  ShotId,
  alignBoundary,
  type BoundaryAlignment,
  type ProjectId,
  type Shot,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 拍とのズレを画面に繋ぐための表示ロジック（P63-1）。**React を含まない純粋関数だけ。**
 *
 * **判定の規則はここに書かない。** 正は `@ixa/domain` の `alignBoundary` だけで、
 * しきい値もそちらにしかない。このファイルがするのは
 * 「呼ぶ材料を揃える」「返ってきた状態を色と日本語にする」の 2 つに限る（lessons L-016）。
 */

// --- 拍の出どころ ---

/**
 * 拍の出どころの状態。API の `TimelineBeatSourceState` と同じ区別。
 *
 * **「楽曲が無い」「解析が無い」「拍が 0 件」を混ぜない**（L-015）。
 * どれも結果は「色が付かない」だが、利用者が取るべき次の行動が違う。
 * プロセスをまたぐので値の列は写しになる。**増やすときは API 側と同時に直す。**
 */
export const BeatAlignmentSource = z.enum(['available', 'no_beats', 'no_analysis', 'no_track'])
export type BeatAlignmentSource = z.infer<typeof BeatAlignmentSource>

// --- API の受け取り形 ---

export const WireShotBeatAlignment = z.object({
  shotId: ShotId,
  atSec: z.number(),
  nearestBeatSec: z.number().nullable(),
  driftSec: z.number().nullable(),
  alignment: BeatAlignment,
})
export type WireShotBeatAlignment = z.infer<typeof WireShotBeatAlignment>

export const WireTimelineBeatAlignment = z.object({
  source: BeatAlignmentSource,
  trackTitle: z.string().nullable(),
  shots: z.array(WireShotBeatAlignment),
})
export type WireTimelineBeatAlignment = z.infer<typeof WireTimelineBeatAlignment>

export type BeatAlignmentApi = {
  /** Shot の境目が拍からどれだけズレているか。**状態も一緒に返る。** */
  getTimelineBeatAlignment: (projectId: ProjectId) => Promise<WireTimelineBeatAlignment>
}

export const createBeatAlignmentApi = (requester: Requester): BeatAlignmentApi => ({
  getTimelineBeatAlignment: async (projectId) =>
    requester.get(
      `/projects/${encodeURIComponent(projectId)}/timeline/beat-alignment`,
      WireTimelineBeatAlignment,
    ),
})

// --- 手元の解析から作る ---

/** 1 Shot 分の整列。API から来ても、手元の解析から作っても同じ形。 */
export type ShotBeatAlignmentView = BoundaryAlignment & { readonly shotId: ShotId }

/**
 * 解析を既に持っている画面（ストーリーボード）が、往復せずに作るための入口。
 * **見るのは Shot の開始位置だけ。** 終わりは次の Shot の開始と同じ境目なので、
 * 両方数えると同じズレを二重に数える。
 */
export const buildShotAlignments = (
  shots: readonly Shot[],
  beats: readonly number[],
  downbeats: readonly number[],
): readonly ShotBeatAlignmentView[] =>
  shots.map((shot) => ({ shotId: shot.id, ...alignBoundary(shot.startSec, beats, downbeats) }))

export const alignmentByShotId = (
  views: readonly ShotBeatAlignmentView[],
): ReadonlyMap<ShotId, ShotBeatAlignmentView> => new Map(views.map((view) => [view.shotId, view]))

// --- 言い換え ---

/** **間違いとして書かない。** どこに合っているかを言うだけ（`onBeatSentence` 参照）。 */
const ALIGNMENT_LABELS: Readonly<Record<BeatAlignment, string>> = {
  on_downbeat: '小節頭に乗っています',
  on_beat: '拍に乗っています',
  near: '拍のすぐ近くです',
  off_beat: '拍以外に合っています',
  no_beats: '拍が分かっていません',
}

export const alignmentLabel = (alignment: BeatAlignment): string => ALIGNMENT_LABELS[alignment]

/** ズレを符号つきで読める形に。**拍が無いときは 0 と書かない**（乗っていると読める）。 */
export const describeDrift = (view: ShotBeatAlignmentView): string => {
  if (view.driftSec === null) return alignmentLabel(view.alignment)
  const sign = view.driftSec >= 0 ? '+' : ''
  return `${alignmentLabel(view.alignment)}（${sign}${view.driftSec.toFixed(3)}s）`
}

// --- 色 ---

/**
 * VIDEO1 のチップの縁。**帯全体で 1 つの縁しか出せない**ので、順番を決めておく。
 *
 * **載っていない Shot（Take 無し）が最優先。** その Shot は映像に出ないので、
 * 拍に乗っているかどうかを先に見せても直す手がかりにならない。
 * 拍の状態は `title` に残るので消えはしない。
 */
const CHIP_RING: Readonly<Record<BeatAlignment, string>> = {
  on_downbeat: 'ring-1 ring-ok',
  on_beat: 'ring-1 ring-ok/60',
  // **警告の色（warn / danger）を使わない。** 拍以外に合わせるのは編集の選択であって誤りではない。
  near: 'ring-1 ring-line-strong',
  off_beat: 'ring-1 ring-line-strong',
  // 拍が分かっていないだけ。**ズレの色（warn / danger）と同じ見た目にしない。**
  no_beats: 'ring-1 ring-line-strong',
}

export const chipRingClass = (input: {
  readonly rendered: boolean
  readonly alignment: BeatAlignment | null
}): string => {
  if (!input.rendered) return 'ring-1 ring-warn/40'
  if (input.alignment === null) return 'ring-1 ring-line-strong'
  return CHIP_RING[input.alignment]
}

/**
 * ポスター帯の縁。左の辺だけを塗る。
 * 選択中の枠（`ring-accent`）と場所が重ならないので、両方を同時に出せる。
 */
const POSTER_EDGE: Readonly<Record<BeatAlignment, string>> = {
  on_downbeat: 'border-l-4 border-l-ok',
  on_beat: 'border-l-4 border-l-ok/50',
  // 拍に乗っているものだけ色を付ける。乗っていないことは色で咎めない。
  near: '',
  off_beat: '',
  no_beats: '',
}

export const posterEdgeClass = (alignment: BeatAlignment | null): string =>
  alignment === null ? '' : POSTER_EDGE[alignment]

// --- 全体の 1 行 ---

export type BeatAlignmentTone = 'ok' | 'warn' | 'danger' | 'muted'

const TONE_CLASSES: Readonly<Record<BeatAlignmentTone, string>> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-muted',
}

/**
 * 一覧に出す短い印。**列は狭いので、乗っているものは点だけにする。**
 * 6 割が外れている状態で全部に文字を出すと、どれを見ればいいか分からなくなる。
 */
const ALIGNMENT_MARKS: Readonly<Record<BeatAlignment, string>> = {
  on_downbeat: '◎',
  on_beat: '○',
  // `✕` は間違いに見える。拍以外に合っているだけなので、記号も中立にする。
  near: '≈',
  off_beat: '·',
  no_beats: '—',
}

export const alignmentMark = (alignment: BeatAlignment): string => ALIGNMENT_MARKS[alignment]

const ALIGNMENT_TEXT: Readonly<Record<BeatAlignment, string>> = {
  on_downbeat: 'text-ok',
  on_beat: 'text-ok/70',
  // 一覧の数字も咎めない。印（△ / ✕）で種類が分かれば足りる。
  near: 'text-muted',
  off_beat: 'text-text',
  no_beats: 'text-muted',
}

export const alignmentTextClass = (alignment: BeatAlignment): string => ALIGNMENT_TEXT[alignment]

/** 一覧のセルに出す 1 行。ズレているものだけ秒を添える（乗っているものに 0.000s と書かない）。 */
export const alignmentCellText = (view: ShotBeatAlignmentView | undefined): string => {
  if (view === undefined) return ''
  const mark = alignmentMark(view.alignment)
  if (view.driftSec === null) return mark
  if (view.alignment === 'on_beat' || view.alignment === 'on_downbeat') return mark
  // 列が狭い（右ペインは 320px）。単位は列の見出し「拍」と title が持つ。
  const sign = view.driftSec >= 0 ? '+' : ''
  return `${mark}${sign}${view.driftSec.toFixed(2)}`
}

/** 拍から外れている（または わずかにズレている）Shot。絞り込みに使う。 */
export const isDrifting = (view: ShotBeatAlignmentView | undefined): boolean =>
  view !== undefined && (view.alignment === 'off_beat' || view.alignment === 'near')

export const beatAlignmentToneClass = (tone: BeatAlignmentTone): string => TONE_CLASSES[tone]

export type BeatAlignmentSummary = {
  readonly tone: BeatAlignmentTone
  readonly text: string
}

const EMPTY_COUNTS: Readonly<Record<BeatAlignment, number>> = {
  on_downbeat: 0,
  on_beat: 0,
  near: 0,
  off_beat: 0,
  no_beats: 0,
}

export const countByAlignment = (
  views: readonly ShotBeatAlignmentView[],
): Readonly<Record<BeatAlignment, number>> =>
  views.reduce<Record<BeatAlignment, number>>(
    (counts, view) => ({ ...counts, [view.alignment]: counts[view.alignment] + 1 }),
    { ...EMPTY_COUNTS },
  )

const trackName = (trackTitle: string | null): string =>
  trackTitle === null ? 'この楽曲' : `「${trackTitle}」`

/**
 * 集計の 1 行。**事実だけを出す。直すべき間違いとして書かない。**
 *
 * 以前は「N 件が拍から外れています」を赤（danger）で出していた。しかし本制作で
 * 実測したところ、外れている 16 件は |ズレ| 0.136〜0.222s（半拍 0.244s の 56〜91%）に
 * 集中し、0〜0.136s には 1 件も無かった。手で外したならここに散らばる。
 * つまりこれは**拍ではないもの（歌い出し・言葉の頭・裏拍）に合わせて切った**形であって、
 * 間違いではない。拍へ吸着させれば 0.14〜0.22s 動く＝聴いて分かる量で、
 * 耳で合わせた位置を壊すことになる。
 *
 * **道具が編集の意図を間違いと決めない。** 数えて並べるところまでが仕事。
 */
const onBeatSentence = (
  total: number,
  counts: Readonly<Record<BeatAlignment, number>>,
): BeatAlignmentSummary => {
  const n = (count: number): string => String(count)
  const onBeat = counts.on_beat + counts.on_downbeat
  const other = counts.near + counts.off_beat

  if (other === 0) {
    return {
      tone: 'ok',
      text: `${n(total)} 件すべてが拍に乗っています（うち ${n(counts.on_downbeat)} 件は小節頭）`,
    }
  }
  return {
    tone: 'muted',
    text: `拍に乗っている ${n(onBeat)} 件 / 拍以外に合わせている ${n(other)} 件`,
  }
}

/**
 * 全体の 1 行。**色だけでは全体像が掴めない**ので、必ず件数を添える。
 *
 * 拍が無いときに「0 件が外れています」と出さない。
 * 数えていないのに合格に見せることになる（L-015）。
 */
export const summarizeBeatAlignment = (input: {
  readonly source: BeatAlignmentSource
  readonly trackTitle: string | null
  readonly views: readonly ShotBeatAlignmentView[]
}): BeatAlignmentSummary => {
  switch (input.source) {
    case 'no_track':
      return {
        tone: 'muted',
        text: '楽曲が登録されていないので、拍とのズレは分かりません（外れているという意味ではありません）',
      }
    case 'no_analysis':
      return {
        tone: 'warn',
        text: `${trackName(input.trackTitle)}はまだ解析されていないので、拍とのズレは分かりません。解析を流すと色が付きます`,
      }
    case 'no_beats':
      return {
        tone: 'warn',
        text: `${trackName(input.trackTitle)}の解析に拍が 1 件もないので、拍とのズレは分かりません`,
      }
    case 'available':
      return input.views.length === 0
        ? { tone: 'muted', text: 'Shot がまだありません' }
        : onBeatSentence(input.views.length, countByAlignment(input.views))
  }
}
