import {
  TRANSITION_SUPPORT,
  TEXT_TEMPLATE_SUPPORT,
  TextClipParams,
  TextTemplateKey,
  TransitionType,
  isDegradedTransition,
  isPlaceholderTextTemplate,
  shotEndSec,
  type Shot,
  type TimelineClip,
  type TimelineClipId,
  type TimelineTrack,
  type Transition,
} from '@ixa/domain'
import {
  adjacentShotPairs,
  describeClipContent,
  formatClock,
  formatDuration,
  formatTimeSpan,
  lanesForTrack,
  parseDurationSec,
  parseSeconds,
  secondsToPx,
  transitionForPair,
  transitionTypeLabel,
  type ShotPair,
  type TimeSpan,
} from '@/lib/timeline-display'

/**
 * タイムラインの「ここに挿せる」を算出する。**React を含まない純粋関数だけを置く。**
 * 判定はすべてここに置き、画面は返ってきたものを表示するだけにする。
 * 時間は常に秒（float）。入力は一切変更せず、常に新しい値を返す。
 *
 * **絵に出せるかの正は `TRANSITION_SUPPORT` / `TEXT_TEMPLATE_SUPPORT` だけ。**
 * 種別をここで数え直さない（lessons L-016）。
 */

/**
 * 時間の比較に使う許容誤差。`packages/timeline` の `TIME_EPSILON` と同じ値。
 * **本来は書き写したくない**が、`@ixa/timeline` の `index.ts` が `ordering.js` を
 * 再公開していないため import できない。再公開されたらこの定数は消すこと。
 */
const TIME_EPSILON = 1e-6

/** 検証に落ちた項目。**1 つずつ直させないため、落ちたものは全部返す。** */
export type InsertIssue = { readonly field: string; readonly message: string }

/**
 * 検証の結果。通ったときも `notices`（止めはしないが伝えるべきこと）を必ず運ぶ。
 * 黙って通すと、選んだ効果が出ないことに書き出すまで気づけない。
 */
export type InsertResult<T> =
  | { readonly ok: true; readonly value: T; readonly notices: readonly string[] }
  | { readonly ok: false; readonly issues: readonly InsertIssue[] }

const nonEmpty = (values: readonly (string | null)[]): readonly string[] =>
  values.flatMap((value) => (value === null || value === '' ? [] : [value]))

const issuesOf = (candidates: readonly (InsertIssue | null)[]): readonly InsertIssue[] =>
  candidates.flatMap((issue) => issue ?? [])

// --- トランジション：選べる種別 ---

/**
 * 挿す種別として出すもの。**`cut` は出さない。**
 *
 * `cut` は「切り替えなし」を意味する。トランジションが無い境目は既にカットなので、
 * そこへ `cut` を置いても絵は 1 フレームも変わらない。
 * 「置いたのに何も起きない」行は、効果を適用したと誤解させるだけになる。
 * カットへ戻す操作は**既存のトランジションの削除**であって、`cut` の挿入ではない。
 */
export const INSERTABLE_TRANSITION_TYPES: readonly TransitionType[] = TransitionType.options.filter(
  (type) => type !== 'cut',
)

export type TransitionTypeOption = {
  readonly type: TransitionType
  readonly label: string
  readonly support: (typeof TRANSITION_SUPPORT)[TransitionType]
  readonly degraded: boolean
  /** 絵に出ない種別のときだけ文言が入る。 */
  readonly notice: string | null
}

const degradedNotice = (type: TransitionType): string | null =>
  isDegradedTransition(type)
    ? `${transitionTypeLabel(type)} はまだ絵に出せない。書き出すとただのカットになる`
    : null

/** 選べる種別。絵に出ない種別も選べるが、注意の文言を一緒に返す。 */
export const transitionTypeOptions = (): readonly TransitionTypeOption[] =>
  INSERTABLE_TRANSITION_TYPES.map((type) => ({
    type,
    label: transitionTypeLabel(type),
    support: TRANSITION_SUPPORT[type],
    degraded: isDegradedTransition(type),
    notice: degradedNotice(type),
  }))

// --- トランジション：尺の上限と既定 ---

/**
 * その境目に置ける最長。**両隣の Shot の短いほう。**
 * のりしろは接する 2 つの Shot から取るので、短いほうを超えると絵が足りない（ADR-0011）。
 *
 * **判定の正は `packages/timeline` の `validateTimeline`（`transition_too_long`）**で、
 * ここはその 1 行を写している。`timeline-insert.test.ts` の契約テストが両者の一致を
 * 固定しており、正が変われば落ちる（lessons L-016）。
 * 本来は `packages/timeline` がこの関数を公開し、双方が呼ぶべき。
 */
export const maxTransitionDurationSec = (pair: ShotPair): number =>
  Math.min(pair.from.durationSec, pair.to.durationSec)

/**
 * 既定の尺 0.5 秒。30fps で 15 フレーム。
 * ディゾルブとして読める最短がこのあたりで、これ以上長いと短い Shot をまるごと食う。
 */
export const DEFAULT_TRANSITION_DURATION_SEC = 0.5

export const defaultTransitionDurationSec = (pair: ShotPair): number =>
  Math.min(DEFAULT_TRANSITION_DURATION_SEC, maxTransitionDurationSec(pair))

// --- トランジション：挿せる場所 ---

/** 空いている境目は挿せる。埋まっている境目は差し替え・削除ができる。 */
export type TransitionInsertionState = 'insertable' | 'replaceable'

export type TransitionInsertionPoint = {
  readonly pair: ShotPair
  readonly fromEndSec: number
  readonly toStartSec: number
  /** ホバー用の 1 点。隙間があればその中央、無ければ境目そのもの。 */
  readonly atSec: number
  /** 隣り合う Shot の間の隙間。無ければ 0。 */
  readonly gapSec: number
  readonly existing: Transition | null
  readonly state: TransitionInsertionState
  readonly maxDurationSec: number
  readonly defaultDurationSec: number
  readonly notices: readonly string[]
  readonly message: string
}

const pointNotices = (existing: Transition | null, gapSec: number): readonly string[] =>
  nonEmpty([
    gapSec > TIME_EPSILON
      ? `この境目には ${formatDuration(gapSec)} の隙間があり、そこは黒画面になる`
      : null,
    existing?.type === 'cut'
      ? 'ここに置かれているのは「カット」なので、実際には切り替えの効果が無い'
      : null,
    existing === null ? null : degradedNotice(existing.type),
  ])

const pointMessage = (pair: ShotPair, existing: Transition | null, maxSec: number): string =>
  existing === null
    ? `${pair.from.code} → ${pair.to.code} の間にトランジションを挿せる（上限 ${formatDuration(maxSec)}）`
    : `${pair.from.code} → ${pair.to.code} は ${transitionTypeLabel(existing.type)} ` +
      `${formatDuration(existing.durationSec)}。差し替え・削除ができる`

/**
 * 隣り合う Shot の境目それぞれについて、挿せるか差し替えられるかを返す。
 * Shot が 0 個・1 個なら境目が無いので空。
 */
export const transitionInsertionPoints = (
  shots: readonly Shot[],
  transitions: readonly Transition[],
): readonly TransitionInsertionPoint[] =>
  adjacentShotPairs(shots).map((pair) => {
    const existing = transitionForPair(transitions, pair)
    const fromEndSec = shotEndSec(pair.from)
    const toStartSec = pair.to.startSec
    const gapSec = Math.max(toStartSec - fromEndSec, 0)
    const maxDurationSec = maxTransitionDurationSec(pair)
    return {
      pair,
      fromEndSec,
      toStartSec,
      atSec: (fromEndSec + toStartSec) / 2,
      gapSec,
      existing,
      state: existing === null ? 'insertable' : 'replaceable',
      maxDurationSec,
      defaultDurationSec: Math.min(DEFAULT_TRANSITION_DURATION_SEC, maxDurationSec),
      notices: pointNotices(existing, gapSec),
      message: pointMessage(pair, existing, maxDurationSec),
    }
  })

/** 挿入ボタンを置く x 座標（px）。 */
export const transitionInsertionLeftPx = (
  point: TransitionInsertionPoint,
  pxPerSec: number,
): number => secondsToPx(point.atSec, pxPerSec)

// --- トランジション：入力の検証 ---

/** 画面のフォームから来る生の値。数値へ落とす前に渡す。 */
export type TransitionInsertDraft = { readonly type: string; readonly durationSec: string }

export type ValidatedTransitionInsert = {
  readonly fromShotId: Shot['id']
  readonly toShotId: Shot['id']
  readonly type: TransitionType
  readonly durationSec: number
}

const transitionTypeIssue = (raw: string): InsertIssue | null => {
  const parsed = TransitionType.safeParse(raw)
  if (!parsed.success) return { field: 'type', message: 'トランジションの種類を選んでください' }
  return parsed.data === 'cut'
    ? {
        field: 'type',
        message:
          'カットは「切り替えなし」なので置く必要はありません。' +
          '既にあるトランジションを削除すると、その境目はカットになります',
      }
    : null
}

const tooLongIssue = (point: TransitionInsertionPoint, durationSec: number): InsertIssue | null =>
  durationSec > point.maxDurationSec + TIME_EPSILON
    ? {
        field: 'durationSec',
        message:
          `尺は両隣の Shot（${point.pair.from.code}=${formatDuration(point.pair.from.durationSec)} / ` +
          `${point.pair.to.code}=${formatDuration(point.pair.to.durationSec)}）を超えられません。` +
          `上限は ${formatDuration(point.maxDurationSec)} です`,
      }
    : null

/** 落ちた項目はすべて返す。種類と尺は独立に検査する。 */
export const validateTransitionInsert = (
  point: TransitionInsertionPoint,
  draft: TransitionInsertDraft,
): InsertResult<ValidatedTransitionInsert> => {
  const type = TransitionType.safeParse(draft.type)
  const duration = parseDurationSec(draft.durationSec)
  const issues = issuesOf([
    transitionTypeIssue(draft.type),
    duration.ok ? null : { field: 'durationSec', message: duration.message },
    duration.ok ? tooLongIssue(point, duration.value) : null,
  ])

  if (issues.length > 0 || !type.success || !duration.ok) return { ok: false, issues }
  return {
    ok: true,
    value: {
      fromShotId: point.pair.from.id,
      toShotId: point.pair.to.id,
      type: type.data,
      durationSec: duration.value,
    },
    notices: nonEmpty([...point.notices, degradedNotice(type.data)]),
  }
}

// --- テロップ：選べるテンプレート ---

/** 表示名。ズレても壊れないものだけを画面側に置く（lessons L-016）。 */
const TEXT_TEMPLATE_LABELS: Readonly<Record<TextTemplateKey, string>> = {
  plain: '中央（飾りなし）',
  lower_third: '下帯（ローワーサード）',
}

export type TextTemplateOption = {
  readonly key: TextTemplateKey
  readonly label: string
  readonly support: (typeof TEXT_TEMPLATE_SUPPORT)[TextTemplateKey]
  readonly placeholder: boolean
  readonly notice: string | null
}

const placeholderNotice = (key: TextTemplateKey): string | null =>
  isPlaceholderTextTemplate(key)
    ? `${TEXT_TEMPLATE_LABELS[key]} はまだ枠しか出ない。書き出しても文字は載らない`
    : null

export const textTemplateOptions = (): readonly TextTemplateOption[] =>
  TextTemplateKey.options.map((key) => ({
    key,
    label: TEXT_TEMPLATE_LABELS[key],
    support: TEXT_TEMPLATE_SUPPORT[key],
    placeholder: isPlaceholderTextTemplate(key),
    notice: placeholderNotice(key),
  }))

// --- テロップ：挿せる場所 ---

/**
 * 既定の尺 3 秒。短い一行を読み切るのに要るのがこのくらい。
 * 次のクリップにぶつかるときは**ぶつかる手前まで縮める**（断らない）。
 * 編集ソフトで放り込んだときの手触りに合わせる。
 */
export const DEFAULT_TEXT_CLIP_DURATION_SEC = 3

/**
 * これ以上は縮めない下限 0.5 秒。これより短いテロップは点滅にしか見えず読めない。
 * 読めないものを黙って置くより、断って別の場所を指してもらうほうがよい。
 */
export const MIN_TEXT_CLIP_DURATION_SEC = 0.5

/**
 * その層で空いている区間。`programEndSec` までを対象にする。
 * Shot が無い（尺 0）なら置ける場所も無いので空。
 */
export const textInsertionGaps = (
  clips: readonly TimelineClip[],
  track: TimelineTrack,
  layer: number,
  programEndSec: number,
): readonly TimeSpan[] => {
  if (!(programEndSec > 0)) return []
  const occupied = lanesForTrack(clips, track).find((lane) => lane.layer === layer)?.clips ?? []
  const spans: TimeSpan[] = []
  let cursor = 0
  for (const clip of occupied) {
    if (cursor >= programEndSec) break
    const start = Math.min(clip.startSec, programEndSec)
    if (start - cursor > TIME_EPSILON) spans.push({ startSec: cursor, durationSec: start - cursor })
    cursor = Math.max(cursor, clip.startSec + clip.durationSec)
  }
  if (programEndSec - cursor > TIME_EPSILON) {
    spans.push({ startSec: cursor, durationSec: programEndSec - cursor })
  }
  return spans
}

/** 置けない理由。**`null` だけ返して黙らない**（lessons L-015）。 */
export type TextInsertionRefusal = 'no_program' | 'outside_program' | 'occupied' | 'too_narrow'

export type TextInsertionProbe =
  | {
      readonly ok: true
      /** 指した位置を含む空き区間の全体。 */
      readonly gap: TimeSpan
      /** 実際に置く区間。次のクリップにぶつかるなら手前までに縮めてある。 */
      readonly span: TimeSpan
      readonly shortened: boolean
      readonly message: string
    }
  | {
      readonly ok: false
      readonly reason: TextInsertionRefusal
      readonly message: string
      /** 埋まっていて置けないとき、ぶつかった相手。それ以外は null。 */
      readonly blockedBy: TimelineClipId | null
    }

const refuse = (
  reason: TextInsertionRefusal,
  message: string,
  blockedBy: TimelineClipId | null = null,
): TextInsertionProbe => ({ ok: false, reason, message, blockedBy })

const clipCovering = (
  clips: readonly TimelineClip[],
  track: TimelineTrack,
  layer: number,
  atSec: number,
): TimelineClip | null =>
  clips.find(
    (clip) =>
      clip.track === track &&
      clip.layer === layer &&
      atSec >= clip.startSec - TIME_EPSILON &&
      atSec < clip.startSec + clip.durationSec - TIME_EPSILON,
  ) ?? null

/** 帯の上で指した時刻から、そこに置ける区間を決める。置けないときは理由を返す。 */
export const probeTextInsertion = (args: {
  readonly clips: readonly TimelineClip[]
  readonly track: TimelineTrack
  readonly layer: number
  readonly atSec: number
  readonly programEndSec: number
}): TextInsertionProbe => {
  const { clips, track, layer, atSec, programEndSec } = args
  if (!(programEndSec > 0)) {
    return refuse('no_program', 'Shot がまだ無いので、テロップを置ける場所がありません')
  }
  if (atSec < -TIME_EPSILON || atSec >= programEndSec - TIME_EPSILON) {
    return refuse(
      'outside_program',
      `映像は ${formatClock(0)} – ${formatClock(programEndSec)} まで。その外にはテロップを置けません`,
    )
  }

  const gap = textInsertionGaps(clips, track, layer, programEndSec).find(
    (span) =>
      atSec >= span.startSec - TIME_EPSILON &&
      atSec < span.startSec + span.durationSec - TIME_EPSILON,
  )
  if (gap === undefined) {
    const blocking = clipCovering(clips, track, layer, atSec)
    return refuse(
      'occupied',
      blocking === null
        ? `${formatClock(atSec)} には置けません。空いているところを指してください`
        : `${formatClock(atSec)} には既に ${describeClipContent(blocking.content)} が` +
            `置かれています（${formatTimeSpan(blocking)}）`,
      blocking?.id ?? null,
    )
  }

  const room = gap.startSec + gap.durationSec - atSec
  if (room < MIN_TEXT_CLIP_DURATION_SEC - TIME_EPSILON) {
    return refuse(
      'too_narrow',
      `ここは残り ${formatDuration(room)} しかありません。` +
        `テロップは ${formatDuration(MIN_TEXT_CLIP_DURATION_SEC)} 以上必要です`,
    )
  }

  const durationSec = Math.min(DEFAULT_TEXT_CLIP_DURATION_SEC, room)
  const shortened = durationSec < DEFAULT_TEXT_CLIP_DURATION_SEC - TIME_EPSILON
  const span: TimeSpan = { startSec: atSec, durationSec }
  return {
    ok: true,
    gap,
    span,
    shortened,
    message: shortened
      ? `${formatTimeSpan(span)} に置けます（次のクリップにぶつかるので ${formatDuration(durationSec)} に縮めた）`
      : `${formatTimeSpan(span)} に置けます（${formatDuration(durationSec)}）`,
  }
}

// --- テロップ：入力の検証 ---

export type TextClipInsertDraft = {
  readonly templateKey: string
  readonly text: string
  readonly startSec: string
  readonly durationSec: string
}

export type ValidatedTextClipInsert = {
  readonly track: TimelineTrack
  readonly layer: number
  readonly startSec: number
  readonly durationSec: number
  readonly templateKey: TextTemplateKey
  readonly params: TextClipParams
}

/**
 * 文字の検証は `TextClipParams` に任せる。**上限や空判定をここへ書き写さない。**
 * zod の指摘は 1 件ずつ項目として返す。
 */
const textIssues = (raw: string): readonly InsertIssue[] => {
  const parsed = TextClipParams.safeParse({ text: raw })
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ field: 'text', message: issue.message }))
}

/** 同じトラックの同じ層で重なるクリップ。層内の重なりの検査は `packages/timeline` に無い。 */
const overlapIssue = (
  clips: readonly TimelineClip[],
  track: TimelineTrack,
  layer: number,
  span: TimeSpan,
): InsertIssue | null => {
  const end = span.startSec + span.durationSec
  const conflict = clips.find(
    (clip) =>
      clip.track === track &&
      clip.layer === layer &&
      span.startSec < clip.startSec + clip.durationSec - TIME_EPSILON &&
      end > clip.startSec + TIME_EPSILON,
  )
  return conflict === undefined
    ? null
    : {
        field: 'startSec',
        message:
          `${formatTimeSpan(span)} は既にある ${describeClipContent(conflict.content)}` +
          `（${formatTimeSpan(conflict)}）と重なります`,
      }
}

/** 落ちた項目はすべて返す。テンプレート・文字・開始・尺を独立に検査する。 */
export const validateTextClipInsert = (args: {
  readonly clips: readonly TimelineClip[]
  readonly track: TimelineTrack
  readonly layer: number
  readonly programEndSec: number
  readonly draft: TextClipInsertDraft
}): InsertResult<ValidatedTextClipInsert> => {
  const { clips, track, layer, programEndSec, draft } = args
  const template = TextTemplateKey.safeParse(draft.templateKey)
  const params = TextClipParams.safeParse({ text: draft.text })
  const start = parseSeconds(draft.startSec)
  const duration = parseDurationSec(draft.durationSec)
  const span: TimeSpan | null =
    start.ok && duration.ok ? { startSec: start.value, durationSec: duration.value } : null

  const issues = [
    ...issuesOf([
      template.success
        ? null
        : { field: 'templateKey', message: 'テロップの見せ方を選んでください' },
    ]),
    ...textIssues(draft.text),
    ...issuesOf([
      start.ok ? null : { field: 'startSec', message: start.message },
      duration.ok ? null : { field: 'durationSec', message: duration.message },
      duration.ok && duration.value < MIN_TEXT_CLIP_DURATION_SEC - TIME_EPSILON
        ? {
            field: 'durationSec',
            message: `テロップは ${formatDuration(MIN_TEXT_CLIP_DURATION_SEC)} 以上必要です`,
          }
        : null,
      span === null ? null : overlapIssue(clips, track, layer, span),
    ]),
  ]

  if (issues.length > 0 || !template.success || !params.success || span === null) {
    return { ok: false, issues }
  }

  /**
   * 映像の終端をはみ出すのは**注意であって却下ではない**。
   * `packages/timeline` の `clip_out_of_range` が warning なので、重さを揃える。
   */
  return {
    ok: true,
    value: {
      track,
      layer,
      startSec: span.startSec,
      durationSec: span.durationSec,
      templateKey: template.data,
      params: params.data,
    },
    notices: nonEmpty([
      span.startSec + span.durationSec > programEndSec + TIME_EPSILON
        ? `このテロップは映像の終端 ${formatClock(programEndSec)} をはみ出す`
        : null,
      placeholderNotice(template.data),
    ]),
  }
}
