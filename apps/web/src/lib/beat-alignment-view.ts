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

const ALIGNMENT_LABELS: Readonly<Record<BeatAlignment, string>> = {
  on_downbeat: '小節頭に乗っています',
  on_beat: '拍に乗っています',
  near: '拍からわずかにズレています',
  off_beat: '拍から外れています',
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
  near: 'ring-2 ring-warn',
  off_beat: 'ring-2 ring-danger',
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
  near: 'border-l-4 border-l-warn',
  off_beat: 'border-l-4 border-l-danger',
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

const onBeatSentence = (
  total: number,
  counts: Readonly<Record<BeatAlignment, number>>,
): BeatAlignmentSummary => {
  const n = (count: number): string => String(count)
  if (counts.off_beat > 0) {
    const near = counts.near === 0 ? '' : `。ほか ${n(counts.near)} 件がわずかにズレています`
    return {
      tone: 'danger',
      text: `${n(total)} 件中 ${n(counts.off_beat)} 件が拍から外れています${near}`,
    }
  }
  if (counts.near > 0) {
    return {
      tone: 'warn',
      text: `${n(total)} 件中 ${n(counts.near)} 件が拍からわずかにズレています`,
    }
  }
  return {
    tone: 'ok',
    text: `${n(total)} 件すべてが拍に乗っています（うち ${n(counts.on_downbeat)} 件は小節頭）`,
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
