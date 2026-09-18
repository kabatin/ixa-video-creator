import type { MusicSection, Shot, ShotId, TimelineClip, TimelineClipId } from '@ixa/domain'
import {
  collectSnapCandidates,
  snapTime,
  snapToleranceSecForZoom,
  type SnapCandidate,
  type SnapResult,
  type SnapTargetKind,
} from '@ixa/timeline'
import { formatClock } from '@/lib/timeline-display'

/**
 * ビート吸着を画面に繋ぐための表示ロジック。**React を含まない純粋関数だけを置く。**
 *
 * **吸着の規則はここに書かない。** 正は `packages/timeline` の `collectSnapCandidates` /
 * `snapTime` / `snapToleranceSecForZoom` だけで、このファイルがするのは
 * 「呼ぶ材料を揃える」「返ってきた結果を日本語にする」の 2 つに限る。
 * 規則を書き写すと必ずズレる（lessons L-016）。
 *
 * 時間は常に秒（float）。入力は一切変更せず、常に新しい値を返す。
 */

// --- 吸着先の名前 ---

const TARGET_LABELS: Readonly<Record<SnapTargetKind, string>> = {
  shot_edge: '隣の Shot の端',
  origin: 'タイムラインの先頭',
  end: 'タイムラインの終端',
  clip_edge: '隣のクリップの端',
  section: '楽曲セクションの境目',
  drop: 'ドロップ',
  beat: 'ビート',
}

export const snapTargetLabel = (kind: SnapTargetKind): string => TARGET_LABELS[kind]

/** 候補の内訳を出すときの並び。ビートは件数が多いので最後に置く。 */
const TARGET_ORDER: readonly SnapTargetKind[] = [
  'shot_edge',
  'clip_edge',
  'section',
  'drop',
  'beat',
  'origin',
  'end',
]

export type SnapCandidateCount = {
  readonly kind: SnapTargetKind
  readonly label: string
  readonly count: number
}

/**
 * 候補の内訳。**0 件の種別は落とす。** 「ビート 0 件」を並べても読み手には
 * 情報が無く、ビートが無いこと自体は解析の状態として別に出す。
 */
export const countSnapCandidates = (
  candidates: readonly SnapCandidate[],
): readonly SnapCandidateCount[] =>
  TARGET_ORDER.map((kind) => ({
    kind,
    label: snapTargetLabel(kind),
    count: candidates.filter((candidate) => candidate.kind === kind).length,
  })).filter((entry) => entry.count > 0)

// --- ビートの出どころ ---

/**
 * ビート候補の供給元。**「解析が無い」と「読めていない」と「ビートが 0 件」を混ぜない。**
 * どれも結果としては「ビートに吸着しない」だが、利用者が取るべき次の行動が違う。
 * 黙って同じ見た目にすると、解析を流せば直る状態を壊れていると誤解させる（lessons L-015）。
 */
export type BeatSource =
  | {
      readonly state: 'available'
      readonly trackTitle: string
      readonly beats: readonly number[]
      readonly sections: readonly MusicSection[]
      readonly drops: readonly number[]
    }
  | { readonly state: 'no_beats'; readonly trackTitle: string }
  | { readonly state: 'no_analysis'; readonly trackTitle: string }
  | { readonly state: 'no_track' }
  | { readonly state: 'unreadable'; readonly reason: string }

export type BeatSourceTone = 'ok' | 'warn' | 'error'

export type BeatSourceNotice = {
  readonly tone: BeatSourceTone
  readonly headline: string
  readonly detail: string
}

/** ビート候補の状態を画面の文言へ。候補が無い場合も必ず理由まで出す。 */
export const describeBeatSource = (source: BeatSource): BeatSourceNotice => {
  switch (source.state) {
    case 'available':
      return {
        tone: 'ok',
        headline: `「${source.trackTitle}」の解析からビート ${String(source.beats.length)} 件を読み込みました`,
        detail: `楽曲セクション ${String(source.sections.length)} 件・ドロップ ${String(source.drops.length)} 件も候補に入っています。`,
      }
    case 'no_beats':
      return {
        tone: 'warn',
        headline: `「${source.trackTitle}」の解析にビートが 1 件もありません`,
        detail:
          '解析は読めています。ビート以外（Shot の端・クリップの端・タイムラインの両端）だけが候補です。',
      }
    case 'no_analysis':
      return {
        tone: 'warn',
        headline: `「${source.trackTitle}」はまだ解析されていません`,
        detail:
          'ビートには吸着しません。候補は Shot の端・クリップの端・タイムラインの両端だけです。ストーリーボード画面から解析を流すと候補が増えます。',
      }
    case 'no_track':
      return {
        tone: 'warn',
        headline: 'このプロジェクトに楽曲が登録されていません',
        detail:
          'ビート・セクション・ドロップの候補はありません。候補は Shot の端・クリップの端・タイムラインの両端だけです。',
      }
    case 'unreadable':
      return {
        tone: 'error',
        headline: '楽曲解析を読み込めませんでした',
        detail: `ビート候補が欠けた状態で吸着します。「候補が無い」ではなく「分からない」状態です: ${source.reason}`,
      }
  }
}

/** 解析から取れたビート。取れていないときは空（`describeBeatSource` が理由を持つ）。 */
const beatsOf = (source: BeatSource): readonly number[] =>
  source.state === 'available' ? source.beats : []

const sectionsOf = (source: BeatSource): readonly MusicSection[] =>
  source.state === 'available' ? source.sections : []

const dropsOf = (source: BeatSource): readonly number[] =>
  source.state === 'available' ? source.drops : []

// --- 候補を集める ---

export type SnapSource = {
  readonly shots: readonly Shot[]
  readonly clips: readonly TimelineClip[]
  readonly beatSource: BeatSource
  readonly timelineEndSec: number
}

/**
 * 動かそうとしている要素自身。**必ず渡す。**
 * 自分の端は距離 0 の候補になり、そこへ吸着して動かせなくなる（`snap.ts` の注記）。
 */
export type SnapExclusion = {
  readonly shotId?: ShotId | null
  readonly clipId?: TimelineClipId | null
}

export const buildSnapCandidates = (
  source: SnapSource,
  exclude: SnapExclusion,
): readonly SnapCandidate[] =>
  collectSnapCandidates({
    beats: beatsOf(source.beatSource),
    shots: source.shots,
    clips: source.clips,
    sections: sectionsOf(source.beatSource),
    drops: dropsOf(source.beatSource),
    timelineEndSec: source.timelineEndSec,
    excludeShotId: exclude.shotId ?? null,
    excludeClipId: exclude.clipId ?? null,
  })

/** ズーム率から許容距離を出す。秒で固定せず画面上の距離で一定にするのは port 側の判断。 */
export const snapToleranceSec = (pxPerSec: number): number => snapToleranceSecForZoom(pxPerSec)

// --- 結果の説明 ---

/**
 * 吸着の結果を説明する 1 件。
 *
 * - `off` — 吸着を切ってあるので寄せていない
 * - `none` — 許容距離内に候補が無く寄らなかった
 * - `snapped` — 候補へ寄せた（**値が変わらなくても吸着である**）
 * - `rejected` — 寄せると尺が 0 以下になるので見送った
 */
export type SnapNotice =
  | { readonly state: 'off'; readonly label: string; readonly message: string }
  | { readonly state: 'none'; readonly label: string; readonly message: string }
  | {
      readonly state: 'snapped'
      readonly label: string
      readonly kind: SnapTargetKind
      readonly message: string
    }
  | { readonly state: 'rejected'; readonly label: string; readonly message: string }

/** 「動いた / 動かなかった」の判定に使う幅。表示用の丸めであって吸着の規則ではない。 */
const DISPLAY_EPSILON_SEC = 0.0005

const describeShift = (fromSec: number, toSec: number): string => {
  const delta = toSec - fromSec
  if (Math.abs(delta) < DISPLAY_EPSILON_SEC) {
    return `${formatClock(toSec)} のまま（元から候補と同じ位置でした）`
  }
  const sign = delta > 0 ? '+' : ''
  return `${formatClock(fromSec)} → ${formatClock(toSec)}（${sign}${delta.toFixed(3)}s）`
}

/**
 * `snapTime` の結果を文にする。
 *
 * **判定は `snappedTo` だけで行い、値の一致では行わない。**
 * 吸着した結果たまたま入力と同じ値になることがあり、値で判断すると
 * 「吸着しなかった」と嘘を表示する（`snap.ts` の `SnapResult` の注記 / lessons L-015）。
 */
export const describeSnapResult = (
  label: string,
  requestedSec: number,
  result: SnapResult,
): SnapNotice => {
  if (result.snappedTo === null) {
    return {
      state: 'none',
      label,
      message: `許容距離内に候補が無く、吸着しませんでした（${formatClock(requestedSec)} のまま）`,
    }
  }
  return {
    state: 'snapped',
    label,
    kind: result.snappedTo.kind,
    message: `${snapTargetLabel(result.snappedTo.kind)}に吸着しました。${describeShift(requestedSec, result.atSec)}`,
  }
}

const snapOffNotice = (label: string, requestedSec: number): SnapNotice => ({
  state: 'off',
  label,
  message: `吸着は切ってあります。入力した ${formatClock(requestedSec)} をそのまま使いました`,
})

// --- 区間の吸着 ---

export type SnapSpanInput = {
  readonly startSec: number
  readonly durationSec: number
}

export type SnapSpanOutcome = {
  readonly startSec: number
  readonly durationSec: number
  readonly notices: readonly SnapNotice[]
}

/**
 * 開始と終了の両方を候補へ寄せ、尺を組み直す。
 *
 * 終了を寄せた結果 尺が 0 以下になる場合は**終了の吸着だけ見送る**。
 * 尺 0 のクリップはタイムラインに乗らないため。見送ったことは必ず notice に残す。
 *
 * 入力は一切変更しない。
 */
export const snapSpan = (
  span: SnapSpanInput,
  candidates: readonly SnapCandidate[],
  toleranceSec: number,
  enabled: boolean,
): SnapSpanOutcome => {
  const requestedEndSec = span.startSec + span.durationSec

  if (!enabled) {
    return {
      startSec: span.startSec,
      durationSec: span.durationSec,
      notices: [snapOffNotice('開始', span.startSec), snapOffNotice('終了', requestedEndSec)],
    }
  }

  const start = snapTime(span.startSec, candidates, toleranceSec)
  const end = snapTime(requestedEndSec, candidates, toleranceSec)
  const startNotice = describeSnapResult('開始', span.startSec, start)
  const snappedDurationSec = end.atSec - start.atSec

  if (end.snappedTo !== null && snappedDurationSec <= 0) {
    return {
      startSec: start.atSec,
      durationSec: span.durationSec,
      notices: [
        startNotice,
        {
          state: 'rejected',
          label: '終了',
          message: `${snapTargetLabel(end.snappedTo.kind)}（${formatClock(end.atSec)}）へ寄せると尺が 0 以下になるため、終了の吸着は見送りました`,
        },
      ],
    }
  }

  return {
    startSec: start.atSec,
    durationSec: end.snappedTo === null ? span.durationSec : snappedDurationSec,
    notices: [startNotice, describeSnapResult('終了', requestedEndSec, end)],
  }
}

// --- 表示の見た目 ---

/**
 * `text-xs`（12px）の上で使うため、`faint` は使わない。
 * `none`（寄せ先が無かった）より `rejected`（寄せるのを見送った）の方が強い報せ。
 */
const NOTICE_CLASSES: Readonly<Record<SnapNotice['state'], string>> = {
  off: 'text-muted',
  none: 'text-warn',
  snapped: 'text-ok',
  rejected: 'text-danger',
}

export const snapNoticeClassName = (state: SnapNotice['state']): string => NOTICE_CLASSES[state]
