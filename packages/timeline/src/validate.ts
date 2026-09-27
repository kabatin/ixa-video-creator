import {
  isDegradedTransition,
  parseTextClipParams,
  shotEndSec,
  TextTemplateKey,
  type Shot,
  type ShotId,
  type Transition,
} from '@ixa/domain'
import { timelineDurationSec, type TimelineSource } from './build.js'
import { TIME_EPSILON, shotsEndSec, sortShotsByStart } from './ordering.js'
import { TAKE_SHORT_TOLERANCE_SEC, takeShortfallSec } from './speed.js'

export type TimelineIssue = {
  readonly severity: 'error' | 'warning'
  readonly code: string
  readonly message: string
  readonly shotId?: ShotId
}

/** `code` の一覧。呼び出し側が文字列リテラルを書かずに済むように公開する。 */
export const TIMELINE_ISSUE_CODES = {
  shotOverlap: 'shot_overlap',
  shotNonPositiveDuration: 'shot_non_positive_duration',
  transitionNotAdjacent: 'transition_not_adjacent',
  transitionTooLong: 'transition_too_long',
  shotGap: 'shot_gap',
  shotGapHead: 'shot_gap_head',
  shotGapTail: 'shot_gap_tail',
  shotMissingTake: 'shot_missing_take',
  shotTakeShort: 'shot_take_short',
  clipOutOfRange: 'clip_out_of_range',
  transitionDegraded: 'transition_degraded',
  textClipUnreadable: 'text_clip_unreadable',
} as const

const sec = (value: number): string => `${value.toFixed(3)}s`

/**
 * 重なっている Shot（error）。Shot の時間は互いに重ならない（ADR-0002）。
 *
 * `@ixa/domain` の `findOverlappingShots` は隣接ペアだけを見るため、
 * 1 つの長い Shot が 2 つ以上の Shot をまたぐ場合を取りこぼす。
 * レンダリング前の検査では見落としが事故になるので、ここでは全ペアを列挙する。
 */
const checkOverlaps = (sorted: readonly Shot[]): TimelineIssue[] => {
  const issues: TimelineIssue[] = []
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]
    if (current === undefined) continue
    const end = shotEndSec(current)
    for (let j = i + 1; j < sorted.length; j += 1) {
      const next = sorted[j]
      if (next === undefined) continue
      if (next.startSec >= end - TIME_EPSILON) break
      issues.push({
        severity: 'error',
        code: TIMELINE_ISSUE_CODES.shotOverlap,
        message:
          `Shot ${current.code} (${sec(current.startSec)}–${sec(end)}) と ` +
          `Shot ${next.code} (${sec(next.startSec)}–${sec(shotEndSec(next))}) の時間が重なっている`,
        shotId: current.id,
      })
    }
  }
  return issues
}

/** 尺が 0 以下の Shot（error）。尺 0 の Shot はタイムラインに乗らない。 */
const checkDurations = (shots: readonly Shot[]): TimelineIssue[] =>
  shots
    .filter((shot) => !(shot.durationSec > 0))
    .map((shot) => ({
      severity: 'error' as const,
      code: TIMELINE_ISSUE_CODES.shotNonPositiveDuration,
      message: `Shot ${shot.code} の編集尺が 0 以下（${sec(shot.durationSec)}）`,
      shotId: shot.id,
    }))

/** Shot と Shot の間の隙間（warning）。埋めないと黒画面になる。 */
const checkGaps = (sorted: readonly Shot[]): TimelineIssue[] => {
  const issues: TimelineIssue[] = []
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const current = sorted[i]
    const next = sorted[i + 1]
    if (current === undefined || next === undefined) continue
    const end = shotEndSec(current)
    const gap = next.startSec - end
    if (gap > TIME_EPSILON) {
      issues.push({
        severity: 'warning',
        code: TIMELINE_ISSUE_CODES.shotGap,
        message:
          `Shot ${current.code} と Shot ${next.code} の間に ${sec(gap)} の隙間がある` +
          `（${sec(end)}–${sec(next.startSec)} が黒画面になる）`,
        shotId: current.id,
      })
    }
  }
  return issues
}

/**
 * 曲の頭と尻の黒（warning）。`checkGaps` は Shot と Shot の**間**しか見ない。
 *
 * タイムラインの尺は曲の終わりまで伸びる（`timelineDurationSec`）ので、
 * 0 秒から最初の Shot まで、最後の Shot から尺の終わりまでは黒画面で書き出される。
 * 以前はここを見ておらず、頭と尻が黒い動画を「指摘なし」のまま書き出していた。
 *
 * **埋めはしない。** 歌い出しまで黒にしたい、という意図もありうる。秒数を添えて言うだけ。
 */
const checkEdgeGaps = (source: TimelineSource, sorted: readonly Shot[]): TimelineIssue[] => {
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined) return []

  const issues: TimelineIssue[] = []
  if (first.startSec > TIME_EPSILON) {
    issues.push({
      severity: 'warning',
      code: TIMELINE_ISSUE_CODES.shotGapHead,
      message:
        `曲の頭から最初の Shot ${first.code} までの ${sec(first.startSec)} が黒画面になる` +
        `（0.000s–${sec(first.startSec)}）`,
      shotId: first.id,
    })
  }

  const end = shotEndSec(last)
  const tail = timelineDurationSec(source) - end
  if (tail > TIME_EPSILON) {
    issues.push({
      severity: 'warning',
      code: TIMELINE_ISSUE_CODES.shotGapTail,
      message:
        `最後の Shot ${last.code} から曲の終わりまでの ${sec(tail)} が黒画面になる` +
        `（${sec(end)}–${sec(end + tail)}）`,
      shotId: last.id,
    })
  }
  return issues
}

/** 採用 Take が無い Shot（warning）。VIDEO1 から除外されるので映像が欠ける。 */
const checkMissingTakes = (
  shots: readonly Shot[],
  resolveShotMedia: TimelineSource['resolveShotMedia'],
): TimelineIssue[] =>
  shots
    .filter((shot) => resolveShotMedia(shot) === undefined)
    .map((shot) => ({
      severity: 'warning' as const,
      code: TIMELINE_ISSUE_CODES.shotMissingTake,
      message: `Shot ${shot.code} に採用 Take が無いため VIDEO1 に出ない`,
      shotId: shot.id,
    }))

/**
 * Transition の検査（error）。
 *
 * - `fromShotId` / `toShotId` が startSec 順で隣接していること
 * - 尺が、接する Shot の尺を超えないこと。超えると重なりを作る素材が足りない
 *   （のりしろは生成尺の余りから取る。ADR-0011）
 */
const checkTransitions = (
  sorted: readonly Shot[],
  transitions: readonly Transition[],
): TimelineIssue[] => {
  const indexById = new Map<ShotId, number>(sorted.map((shot, index) => [shot.id, index]))
  const issues: TimelineIssue[] = []

  for (const transition of transitions) {
    const fromIndex = indexById.get(transition.fromShotId)
    const toIndex = indexById.get(transition.toShotId)

    if (fromIndex === undefined || toIndex === undefined) {
      issues.push({
        severity: 'error',
        code: TIMELINE_ISSUE_CODES.transitionNotAdjacent,
        message:
          `Transition ${transition.type} が参照する Shot がタイムラインに無い` +
          `（from=${transition.fromShotId} to=${transition.toShotId}）`,
      })
      continue
    }

    /**
     * 絵に出ない種別（wipe / whip_pan / glitch）はレンダリング時に cut へ落ちる。
     * **黙って落とさない。** 置いた本人は選んだ効果が出ると思っている。
     * error にはしない。出力自体は作れるので、止めるより伝えるほうが役に立つ。
     */
    if (isDegradedTransition(transition.type)) {
      issues.push({
        severity: 'warning',
        code: TIMELINE_ISSUE_CODES.transitionDegraded,
        message:
          `Transition ${transition.type} はまだ絵に出せないため、レンダリングでは` +
          `ただのカットになる`,
        shotId: transition.fromShotId,
      })
    }

    if (toIndex !== fromIndex + 1) {
      issues.push({
        severity: 'error',
        code: TIMELINE_ISSUE_CODES.transitionNotAdjacent,
        message: `Transition ${transition.type} が繋ぐ 2 つの Shot が隣接していない`,
        shotId: transition.fromShotId,
      })
      continue
    }

    const from = sorted[fromIndex]
    const to = sorted[toIndex]
    if (from === undefined || to === undefined) continue

    const shortest = Math.min(from.durationSec, to.durationSec)
    if (transition.durationSec > shortest + TIME_EPSILON) {
      issues.push({
        severity: 'error',
        code: TIMELINE_ISSUE_CODES.transitionTooLong,
        message:
          `Transition ${transition.type} の尺 ${sec(transition.durationSec)} が ` +
          `接する Shot の尺（${from.code}=${sec(from.durationSec)} / ` +
          `${to.code}=${sec(to.durationSec)}）を超えている`,
        shotId: transition.fromShotId,
      })
    }
  }

  return issues
}

/**
 * 採用 Take が尺に足りない Shot（warning / ADR-0026）。足りない分は**最後のコマで止まる**。
 * 「Take を尺に合わせる」（timing: fit）で速度を落とせば埋まる。長さが分からない Shot は数えない。
 */
const checkTakeShort = (source: TimelineSource, shots: readonly Shot[]): TimelineIssue[] =>
  shots.flatMap((shot) => {
    if (source.resolveShotMedia(shot) === undefined) return []
    const shortfall = takeShortfallSec(shot, source.resolveShotMediaDurationSec?.(shot) ?? null)
    if (shortfall <= TAKE_SHORT_TOLERANCE_SEC) return []
    return [
      {
        severity: 'warning' as const,
        code: TIMELINE_ISSUE_CODES.shotTakeShort,
        message:
          `Shot ${shot.code} の Take が ${shortfall.toFixed(2)}s 足りず、最後のコマで止まる` +
          (shot.timing === 'fit' ? '（速度の下限 0.5 倍でも足りない）' : '（「Take を尺に合わせる」で速度を落とせば埋まる）'),
        shotId: shot.id,
      },
    ]
  })

/**
 * タイムラインの尺をはみ出したクリップ（warning）。
 *
 * 基準は Shot 列の終端。`buildTimelineDocument` の `durationSec` はクリップ自身も含めて
 * 決まるため、そちらを基準にすると検査が常に成立してしまい意味がない。
 * Shot の無いところに乗ったクリップは映像の外に出る。
 */
const checkClips = (source: TimelineSource): TimelineIssue[] => {
  const programEnd = shotsEndSec(source.shots)
  return source.clips
    .filter((clip) => clip.startSec + clip.durationSec > programEnd + TIME_EPSILON)
    .map((clip) => ({
      severity: 'warning' as const,
      code: TIMELINE_ISSUE_CODES.clipOutOfRange,
      message:
        `${clip.track} のクリップが ${sec(clip.startSec + clip.durationSec)} まで伸びており、` +
        `Shot の終端 ${sec(programEnd)} をはみ出している`,
    }))
}

/**
 * 中身を読めないテロップ（warning）。
 *
 * **書き出すと赤いプレースホルダになる。** レンダラは読めない指定を黙って
 * 消さずに赤で描くが（PHASE 5.7）、それは**書き出してみるまで分からない**。
 * 書き出す前の検査に出して、押す前に気付けるようにする。
 *
 * **「知らない種類」と「中身が読めない」を分ける**（lessons L-015）。
 * 前者は古い形式で作られたクリップ、後者は文言が入っていないクリップで、
 * 直し方が違う。同じ文にすると、どちらを直せばよいのか分からない。
 */
const checkTextClips = (source: TimelineSource): TimelineIssue[] =>
  source.clips.flatMap((clip) => {
    if (clip.content.type !== 'text') return []
    const { templateKey, params } = clip.content

    if (!TextTemplateKey.safeParse(templateKey).success) {
      return [
        {
          severity: 'warning' as const,
          code: TIMELINE_ISSUE_CODES.textClipUnreadable,
          message:
            `${sec(clip.startSec)} のテロップが知らない種類「${templateKey}」を指しており、` +
            '書き出すと赤い枠になる（古い形式で作られた可能性がある）',
        },
      ]
    }

    if (parseTextClipParams(params) !== null) return []
    return [
      {
        severity: 'warning' as const,
        code: TIMELINE_ISSUE_CODES.textClipUnreadable,
        message:
          `${sec(clip.startSec)} のテロップに出す文言が入っておらず、書き出すと赤い枠になる`,
      },
    ]
  })

/**
 * タイムラインの不変条件を検査する。**レンダリング前に必ず通す想定。**
 *
 * 1 つ見つけて止めず、すべて列挙する。入力は一切変更しない。
 */
export const validateTimeline = (source: TimelineSource): TimelineIssue[] => {
  const sorted = sortShotsByStart(source.shots)
  return [
    ...checkOverlaps(sorted),
    ...checkDurations(sorted),
    ...checkTransitions(sorted, source.transitions),
    ...checkEdgeGaps(source, sorted),
    ...checkGaps(sorted),
    ...checkMissingTakes(sorted, source.resolveShotMedia),
    ...checkTakeShort(source, sorted),
    ...checkClips(source),
    ...checkTextClips(source),
  ]
}
