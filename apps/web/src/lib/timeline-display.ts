import {
  TimelineTrack as TimelineTrackSchema,
  shotEndSec,
  type Shot,
  type TimelineClip,
  type TimelineTrack,
  type Transition,
  type TransitionType,
} from '@ixa/domain'
import type { TimelineIssueSeverity, TimelineIssueView } from '@/lib/timeline-issues'

/**
 * タイムライン編集画面の表示用ロジック。**React を含まない純粋関数だけを置く。**
 *
 * 時間は常に秒（float）。ミリ秒・フレームをここへ持ち込まない（CLAUDE.md 規約 3）。
 * 入力は一切変更せず、常に新しい値を返す。
 */

// --- トラック（画面の行） ---

/** VIDEO1 は Shot の投影なので `TimelineTrack` に無い（ADR-0002）。行としては先頭に出す。 */
export const VIDEO1_ROW = 'VIDEO1'

/** 編集できるトラック。列挙し直さず、ドメインの enum を唯一の正として使う。 */
export const EDITABLE_TRACKS: readonly TimelineTrack[] = TimelineTrackSchema.options

export type TimelineRow = typeof VIDEO1_ROW | TimelineTrack

/** 画面に縦に並べる行。VIDEO1 が一番上。 */
export const TIMELINE_ROWS: readonly TimelineRow[] = [VIDEO1_ROW, ...EDITABLE_TRACKS]

const ROW_LABELS: Readonly<Record<TimelineRow, string>> = {
  VIDEO1: 'VIDEO1（Shot）',
  VFX: 'VFX（エフェクト）',
  TEXT: 'TEXT（テロップ）',
  VIDEO2: 'VIDEO2（重ね素材）',
  SFX: 'SFX（効果音）',
}

export const timelineRowLabel = (row: TimelineRow): string => ROW_LABELS[row]

const TRANSITION_LABELS: Readonly<Record<TransitionType, string>> = {
  cut: 'カット',
  dissolve: 'ディゾルブ',
  dip_to_black: '黒フェード',
  dip_to_white: '白フェード',
  wipe: 'ワイプ',
  whip_pan: 'ホイップパン',
  glitch: 'グリッチ',
}

export const transitionTypeLabel = (type: TransitionType): string => TRANSITION_LABELS[type]

// --- ズームと座標 ---

/** ズーム率の選択肢。単位は「1 秒あたりの px」。 */
export const ZOOM_LEVELS: readonly number[] = [10, 20, 40, 80, 160]

export const DEFAULT_PX_PER_SEC = 40

/** 尺 0 のクリップを幅 0 で描くと画面から消える。消さずに最低幅で必ず出す。 */
export const MIN_CLIP_WIDTH_PX = 3

/** 秒 → 画面上の x 座標（px）。`pxPerSec` は 1 秒あたりの px。 */
export const secondsToPx = (seconds: number, pxPerSec: number): number => seconds * pxPerSec

/** 画面上の x 座標（px）→ 秒。ズームを跨いでも往復できるようにする。 */
export const pxToSeconds = (px: number, pxPerSec: number): number => px / pxPerSec

export type TimeRect = { readonly leftPx: number; readonly widthPx: number }

export type TimeSpan = { readonly startSec: number; readonly durationSec: number }

/**
 * 時間の区間を矩形へ変換する。
 * 尺が 0 以下でも最低幅で描く。**「置いたのに画面に無い」を作らないため。**
 * 尺 0 そのものは検証の指摘として別に出る。
 */
export const timeSpanToRect = (span: TimeSpan, pxPerSec: number): TimeRect => ({
  leftPx: secondsToPx(span.startSec, pxPerSec),
  widthPx: Math.max(secondsToPx(span.durationSec, pxPerSec), MIN_CLIP_WIDTH_PX),
})

const TICK_STEPS_SEC: readonly number[] = [0.5, 1, 2, 5, 10, 15, 30, 60]
const MIN_TICK_GAP_PX = 56
const MAX_TICKS = 400

/** 目盛りが重ならない最小の刻み。ズームが浅いほど粗くなる。 */
export const rulerTickStepSec = (pxPerSec: number): number =>
  TICK_STEPS_SEC.find((step) => step * pxPerSec >= MIN_TICK_GAP_PX) ??
  TICK_STEPS_SEC[TICK_STEPS_SEC.length - 1] ??
  1

export type RulerTick = {
  readonly sec: number
  readonly leftPx: number
  readonly label: string
}

/** 時間目盛り。尺が無いときは空（目盛りだけ出しても読み手に情報が無い）。 */
export const rulerTicks = (durationSec: number, pxPerSec: number): readonly RulerTick[] => {
  if (!(durationSec > 0) || !(pxPerSec > 0)) return []
  const step = rulerTickStepSec(pxPerSec)
  const count = Math.min(Math.floor(durationSec / step), MAX_TICKS)
  return Array.from({ length: count + 1 }, (_unused, index) => {
    const sec = index * step
    return { sec, leftPx: secondsToPx(sec, pxPerSec), label: formatClock(sec) }
  })
}

// --- レーン（layer の積み上げ） ---

export type TimelineLane<T> = {
  readonly layer: number
  readonly clips: readonly T[]
}

/**
 * トラック内のクリップを `layer` ごとの段へ積み上げる。
 * 段は layer の昇順、段の中は `startSec` の昇順。**入力は変更しない。**
 *
 * layer が飛んでいても段は詰めて返す。空の段を出しても読み手に情報が無いため。
 */
export const stackByLayer = <T extends { readonly layer: number; readonly startSec: number }>(
  clips: readonly T[],
): readonly TimelineLane<T>[] => {
  const layers = [...new Set(clips.map((clip) => clip.layer))].sort((a, b) => a - b)
  return layers.map((layer) => ({
    layer,
    clips: clips
      .filter((clip) => clip.layer === layer)
      .slice()
      .sort((a, b) => a.startSec - b.startSec),
  }))
}

/**
 * 一覧の並び順を画面側で決める。track → layer → startSec の順。
 * API の投入順に依存しないようにするため。**入力は変更しない。**
 */
export const sortClipsForDisplay = (clips: readonly TimelineClip[]): readonly TimelineClip[] =>
  clips
    .map((clip, index) => ({ clip, index }))
    .sort((a, b) => {
      const byTrack = EDITABLE_TRACKS.indexOf(a.clip.track) - EDITABLE_TRACKS.indexOf(b.clip.track)
      if (byTrack !== 0) return byTrack
      const byLayer = a.clip.layer - b.clip.layer
      if (byLayer !== 0) return byLayer
      const byStart = a.clip.startSec - b.clip.startSec
      return byStart === 0 ? a.index - b.index : byStart
    })
    .map((entry) => entry.clip)

/** 指定トラックのクリップだけを、layer の段に積んで返す。 */
export const lanesForTrack = (
  clips: readonly TimelineClip[],
  track: TimelineTrack,
): readonly TimelineLane<TimelineClip>[] =>
  stackByLayer(clips.filter((clip) => clip.track === track))

// --- 尺と時刻の整形 ---

/** `m:ss.SS`。秒は小数第 2 位まで。フレームへ丸めない（CLAUDE.md 規約 3）。 */
export const formatClock = (seconds: number): string => {
  const sign = seconds < 0 ? '-' : ''
  const hundredths = Math.round(Math.abs(seconds) * 100)
  const minutes = Math.floor(hundredths / 6000)
  const rest = (hundredths - minutes * 6000) / 100
  return `${sign}${String(minutes)}:${rest.toFixed(2).padStart(5, '0')}`
}

/** 尺の表示。時刻ではないので `m:ss.SS` と生の秒を併記する。 */
export const formatDuration = (seconds: number): string =>
  `${formatClock(seconds)}（${seconds.toFixed(2)}s）`

/** 区間の表示。開始と終了を同じ書式で並べる。 */
export const formatTimeSpan = (span: TimeSpan): string =>
  `${formatClock(span.startSec)} – ${formatClock(span.startSec + span.durationSec)}`

/** クリップの中身の一行要約。種別ごとに「何が置かれているか」が分かる形にする。 */
export const describeClipContent = (content: TimelineClip['content']): string => {
  switch (content.type) {
    case 'media':
      return `メディア ${content.mediaAssetId}（${content.inSec.toFixed(2)}s–${content.outSec.toFixed(2)}s）`
    case 'text':
      return `テキスト ${content.templateKey}`
    case 'motion_graphics':
      return `モーショングラフィックス ${content.templateKey}`
  }
}

// --- 検証結果の表示整形 ---

const SEVERITY_LABELS: Readonly<Record<TimelineIssueSeverity, string>> = {
  error: 'レンダリング不可',
  warning: '警告',
}

const SEVERITY_CLASSES: Readonly<Record<TimelineIssueSeverity, string>> = {
  error: 'bg-red-100 text-red-800 ring-red-300',
  warning: 'bg-amber-100 text-amber-900 ring-amber-300',
}

export const issueSeverityLabel = (severity: TimelineIssueSeverity): string =>
  SEVERITY_LABELS[severity]

export const issueSeverityClassName = (severity: TimelineIssueSeverity): string =>
  SEVERITY_CLASSES[severity]

/** 重い指摘から読ませる。同じ severity 内は元の順を保つ。**入力は変更しない。** */
export const sortTimelineIssues = (
  issues: readonly TimelineIssueView[],
): readonly TimelineIssueView[] =>
  issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      const rank = (severity: TimelineIssueSeverity): number => (severity === 'error' ? 0 : 1)
      const bySeverity = rank(a.issue.severity) - rank(b.issue.severity)
      return bySeverity === 0 ? a.index - b.index : bySeverity
    })
    .map((entry) => entry.issue)

/**
 * 検証結果の要約。
 *
 * **`unchecked` と `clean` を必ず区別する。** 指摘が空の配列であることと、
 * そもそも検査できていないことは別の事実であり、
 * どちらも「問題なし」と表示すると人は検査済みだと信じてしまう（lessons L-015）。
 */
export type TimelineIssueSummary =
  | { readonly state: 'unchecked'; readonly message: string }
  | { readonly state: 'clean'; readonly message: string }
  | {
      readonly state: 'issues'
      readonly errorCount: number
      readonly warningCount: number
      readonly message: string
    }

export const summarizeTimelineIssues = (
  issues: readonly TimelineIssueView[] | null,
): TimelineIssueSummary => {
  if (issues === null) {
    return { state: 'unchecked', message: 'タイムラインをまだ検査できていません' }
  }
  if (issues.length === 0) {
    return { state: 'clean', message: '検査しました。隙間・重なりともに指摘はありません' }
  }
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  return {
    state: 'issues',
    errorCount,
    warningCount: issues.length - errorCount,
    message: `レンダリング不可 ${String(errorCount)} 件 / 警告 ${String(issues.length - errorCount)} 件`,
  }
}

// --- 入力の解釈 ---

export type ParsedSeconds =
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string }

/**
 * 数値入力を秒として読む。**空文字や `abc` を 0 に落とさない。**
 * 黙って 0 にすると「入力したのに別の値が入る」事故になる。
 */
export const parseSeconds = (raw: string): ParsedSeconds => {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, message: '秒を入力してください' }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { ok: false, message: '秒は数値で入力してください' }
  if (value < 0) return { ok: false, message: '秒に負の値は指定できません' }
  return { ok: true, value }
}

/** 尺として読む。0 はタイムラインに乗らないので受け付けない。 */
export const parseDurationSec = (raw: string): ParsedSeconds => {
  const parsed = parseSeconds(raw)
  if (!parsed.ok) return parsed
  return parsed.value === 0 ? { ok: false, message: '尺は 0 より大きい必要があります' } : parsed
}

export type ParsedLayer = ParsedSeconds

/** 重ね順。整数の 0 以上だけを受け付ける。`1.5` を黙って丸めない。 */
export const parseLayer = (raw: string): ParsedLayer => {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, message: 'layer を入力してください' }
  const value = Number(trimmed)
  if (!Number.isInteger(value)) return { ok: false, message: 'layer は整数で入力してください' }
  if (value < 0) return { ok: false, message: 'layer に負の値は指定できません' }
  return { ok: true, value }
}

// --- Shot の並び ---

/** startSec 昇順。同時刻なら `order`、それも同じなら入力順（安定ソート）。 */
export const sortShotsByStart = (shots: readonly Shot[]): readonly Shot[] =>
  shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const byStart = a.shot.startSec - b.shot.startSec
      if (byStart !== 0) return byStart
      const byOrder = a.shot.order - b.shot.order
      return byOrder === 0 ? a.index - b.index : byOrder
    })
    .map((entry) => entry.shot)

/** Shot 列が覆う終端。Shot が無ければ 0。 */
export const programEndSec = (shots: readonly Shot[]): number =>
  shots.reduce((latest, shot) => Math.max(latest, shotEndSec(shot)), 0)

// --- Shot の組と Transition ---

/** 隣り合う Shot の組。Transition を置ける場所はここだけ。 */
export type ShotPair = {
  readonly from: Shot
  readonly to: Shot
}

export const adjacentShotPairs = (shots: readonly Shot[]): readonly ShotPair[] => {
  const sorted = sortShotsByStart(shots)
  return sorted.flatMap((from, index) => {
    const to = sorted[index + 1]
    return to === undefined ? [] : [{ from, to }]
  })
}

/** 組に既に置かれている Transition。無ければ null。 */
export const transitionForPair = (
  transitions: readonly Transition[],
  pair: ShotPair,
): Transition | null =>
  transitions.find(
    (transition) => transition.fromShotId === pair.from.id && transition.toShotId === pair.to.id,
  ) ?? null
