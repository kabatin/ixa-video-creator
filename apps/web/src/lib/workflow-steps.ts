import { lyricLineOf, projectKindRule, type ProjectKind } from '@ixa/domain'

/**
 * 制作の流れの帯（制作者 2026-10-01）。**React を含まない純粋な関数。**
 *
 * 楽曲 → 作品の方針（方針・歌詞・ルック）→ 歌詞の時刻 → テロップ → ナレーション → 区切って Shot → 絵コンテ（説明）→
 * 絵（最初のフレーム）→ Take → 書き出す（2026-10-03 に並べ直した）。
 * - 歌詞の時刻とテロップは区切る前（制作者 2026-10-02「テロップみたいな、やり直しが容易にできるものを、ステップの前に
 *   持ってった方が効率的」、2026-10-03「まずはテロップのタイミングをセット」）。テロップは黒い画面で、絵を作らずに確かめられる
 * - 区切ってから時刻を付けたら、境目が歌い出しより中央値 1.95 秒早くなり、絵と歌詞がずれた
 * - 区切りは「Shot にする」まで保存されないので、区切ると Shot は 1 つの段にした（区切ったかは Shot の有無でしか分からない）
 *
 * - ナレーションから始める種類（紙芝居・CM・予告。`projectKindRule`）は、歌詞の時刻とテロップの段がそもそも無い
 *
 * 「音楽 → 区切り → Shot → Take」と飛ばして、作品と関係ない映像ができた。各段が済んだか・途中か・
 * 次はどこかを決める。**分からない段は「分からない」のまま**にし、次の段として選ばない（L-021）。
 */

export type WorkflowStepId =
  | 'music'
  | 'concept'
  | 'lyrics'
  | 'telops'
  | 'narration'
  | 'shots'
  | 'storyboard'
  | 'frames'
  | 'takes'
  | 'render'

/** `skipped` は要らない段（「歌詞なし」の作品の歌詞の段など）。次の段に選ばない。理由は `reason`。 */
export type WorkflowStepState = 'done' | 'partial' | 'todo' | 'unknown' | 'skipped'

export type WorkflowStep = {
  readonly id: WorkflowStepId
  readonly label: string
  readonly state: WorkflowStepState
  /** 数えて途中を出す段だけ。数えられないときは null。 */
  readonly progress: { readonly done: number; readonly total: number } | null
  /** 飛ばす段だけ、なぜ飛ばすか（帯の吹き出しに出す）。飛ばさない段は null。 */
  readonly reason: string | null
}

/** 飛ばす理由。**飛ばす規則の隣に置く**（帯が理由を書き写すと、どの段でも同じ話をしてしまう）。 */
export const SKIP_REASONS = {
  instrumental: '「歌詞なし」の作品なので飛ばします（作品の方針で「歌詞なし」を外すと使えます）',
  narrationWithTrack: '曲があるので、ナレーションは入れなくても進めます',
  musicWithNarration: 'ナレーションで進めるので、曲は無くても進めます',
  musicForNarrationKind: 'ナレーションから始める作品なので、曲は無くても進めます（後から足せます）',
} as const

export type WorkflowInput = {
  /** 作品の種類。ナレーションから始める種類には、歌詞の時刻とテロップの段が無い。 */
  readonly kind: ProjectKind
  /** 楽曲（マスター）が登録されているか。 */
  readonly hasTrack: boolean
  /** コンセプト・あらすじ。**読めていなければ null**（空文字は「まだ書いていない」）。 */
  readonly concept: string | null
  /** ルック（画風・光・質感）を書いたか。 */
  readonly hasLook: boolean
  /** 歌詞なしの作品か（作品の方針でチェックする）。歌詞の時刻とテロップの段を飛ばし、方針は方針・ルックで数える。 */
  readonly instrumental: boolean
  /** 歌詞の行数（`lyricLines`）。0 は「まだ書いていない」（飛ばすのは「歌詞なし」を選んだときだけ）。 */
  readonly lyricLineCount: number
  /** 時刻を付けた行の数（`lyricCues` の長さ。前から順に付く）。 */
  readonly lyricCueCount: number
  /** 歌詞から置いたテロップの数。**読めていなければ null**。 */
  readonly lyricTelopCount: number | null
  /**
   * ナレーション（ADR-0038）の行の数と、声を作って置いた行の数。**読めていなければ null**。
   * 曲のある作品では入れなくてよい。曲が無ければ、ナレーションが作品の芯になる。
   */
  readonly narration: { readonly lines: number; readonly ready: number } | null
  readonly shots: readonly {
    readonly description: string
    /** 最初のフレームが付いているか。**分からなければ null**（絵の一覧をまだ読めていない）。 */
    readonly hasStartFrame: boolean | null
    /** Take を採用しているか。 */
    readonly adopted: boolean
  }[]
  /** 書き出しが 1 度でも終わったか。**読めていなければ null**。 */
  readonly rendered: boolean | null
}

const LABELS: Readonly<Record<WorkflowStepId, string>> = {
  music: '楽曲',
  concept: '作品の方針',
  lyrics: '歌詞の時刻',
  telops: 'テロップ',
  narration: 'ナレーション',
  shots: '区切って Shot',
  storyboard: '絵コンテ',
  frames: '絵',
  takes: 'Take',
  render: '書き出す',
}

const flag = (id: WorkflowStepId, done: boolean | null): WorkflowStep => ({
  id,
  label: LABELS[id],
  state: done === null ? 'unknown' : done ? 'done' : 'todo',
  progress: null,
  reason: null,
})

const skipped = (id: WorkflowStepId, reason: string): WorkflowStep => ({
  id,
  label: LABELS[id],
  state: 'skipped',
  progress: null,
  reason,
})

/** 数え上げた段の状態。全部なら済み、0 ならまだ、その間は途中。 */
const tally = (id: WorkflowStepId, done: number, total: number): WorkflowStep => ({
  id,
  label: LABELS[id],
  state: done === total ? 'done' : done === 0 ? 'todo' : 'partial',
  progress: { done, total },
  reason: null,
})

/** Shot ごとに数える段。1 件でも分からなければ件数を出さない。 */
const counted = (id: WorkflowStepId, marks: readonly (boolean | null)[]): WorkflowStep => {
  if (marks.length === 0) return { id, label: LABELS[id], state: 'todo', progress: null, reason: null }
  if (marks.some((mark) => mark === null)) {
    return { id, label: LABELS[id], state: 'unknown', progress: null, reason: null }
  }
  return tally(id, marks.filter((mark) => mark === true).length, marks.length)
}

/** ナレーションから始める種類か。歌詞の時刻とテロップの段が無く、作品の方針でも歌詞を数えない。 */
const startsFromNarration = (input: WorkflowInput): boolean => projectKindRule(input.kind).startsFrom === 'narration'

/** 歌詞を使う作品か。**飛ばすのは制作者が「歌詞なし」を選んだときだけ**（歌詞がまだ無いだけの新しい作品は飛ばさない）。 */
const usesLyrics = (input: WorkflowInput): boolean => !input.instrumental && !startsFromNarration(input)

/** 歌詞の時刻。「歌詞なし」なら飛ばす。行ごとに数える（前から順に付く）。歌詞がまだ無ければ、まだ。 */
const lyricsStep = (input: WorkflowInput): WorkflowStep => {
  if (input.instrumental) return skipped('lyrics', SKIP_REASONS.instrumental)
  if (input.lyricLineCount === 0) return flag('lyrics', false)
  return tally('lyrics', Math.min(input.lyricCueCount, input.lyricLineCount), input.lyricLineCount)
}

/**
 * 作品の方針。方針（コンセプト・あらすじ）・歌詞・ルックの 3 つを数える
 * （制作者 2026-10-03「コンセプト・あらすじの入力、歌詞の入力、ルックの設定をさせたい」）。
 * 歌詞なしの作品は方針・ルックの 2 つ（制作者 2026-10-04「歌詞がない動画の場合、作品の方針が 2/3 でとまってしまう。
 * 歌詞なしのチェックボックスとかあるといいかも」）。
 */
const conceptStep = (input: WorkflowInput): WorkflowStep => {
  if (input.concept === null) return flag('concept', null)
  // ナレーションから始める種類も歌詞の段が無いので、方針・ルックの 2 つで数える。
  const parts = usesLyrics(input)
    ? [input.concept.trim() !== '', input.lyricLineCount > 0, input.hasLook]
    : [input.concept.trim() !== '', input.hasLook]
  return tally('concept', parts.filter(Boolean).length, parts.length)
}

/** テロップ。「歌詞なし」なら飛ばす。歌詞から置いたテロップが 1 つでもあれば済み。 */
const telopsStep = (input: WorkflowInput): WorkflowStep =>
  input.instrumental
    ? skipped('telops', SKIP_REASONS.instrumental)
    : flag('telops', input.lyricTelopCount === null ? null : input.lyricTelopCount > 0)

/**
 * ナレーション。行があれば、声を作って置いた行を数える。行が無ければ、曲のある作品では要らない段（飛ばす）、
 * 曲の無い作品ではまだ（ナレーションが芯になる）。**ナレーションから始める種類は、曲があっても飛ばさない**
 * （BGM を先に入れただけで、作品の芯の段を飛ばしていた）。
 */
const narrationStep = (input: WorkflowInput): WorkflowStep => {
  if (input.narration === null) return flag('narration', null)
  if (input.narration.lines > 0) return tally('narration', input.narration.ready, input.narration.lines)
  return input.hasTrack && !startsFromNarration(input)
    ? skipped('narration', SKIP_REASONS.narrationWithTrack)
    : flag('narration', false)
}

/**
 * 楽曲。曲が無くてもナレーションがあれば飛ばしてよい（予告・宣伝の動画。制作者 2026-10-05）。
 * **ナレーションから始める種類は曲を先に求めない**: 曲が無ければ飛ばし（後から足せる）、あれば済み
 * （以前は楽曲が「次はここ」になり、前のタブ・ストーリーボードの主ボタンと違う所を指していた）。
 */
const musicStep = (input: WorkflowInput): WorkflowStep => {
  if (input.hasTrack) return flag('music', true)
  if (startsFromNarration(input)) return skipped('music', SKIP_REASONS.musicForNarrationKind)
  return (input.narration?.lines ?? 0) > 0 ? skipped('music', SKIP_REASONS.musicWithNarration) : flag('music', false)
}

/** 歌詞の 2 段。ナレーションから始める種類には無い（「—」で並べず、帯から外す）。 */
const lyricSteps = (input: WorkflowInput): readonly WorkflowStep[] =>
  startsFromNarration(input) ? [] : [lyricsStep(input), telopsStep(input)]

export const workflowSteps = (
  input: WorkflowInput,
): { readonly steps: readonly WorkflowStep[]; readonly nextId: WorkflowStepId | null } => {
  const steps: readonly WorkflowStep[] = [
    musicStep(input),
    conceptStep(input),
    ...lyricSteps(input),
    narrationStep(input),
    flag('shots', input.shots.length > 0),
    counted(
      'storyboard',
      input.shots.map((shot) => shot.description.trim() !== ''),
    ),
    counted(
      'frames',
      input.shots.map((shot) => shot.hasStartFrame),
    ),
    counted(
      'takes',
      input.shots.map((shot) => shot.adopted),
    ),
    flag('render', input.rendered),
  ]
  const next = steps.find((step) => step.state === 'todo' || step.state === 'partial')
  return { steps, nextId: next?.id ?? null }
}

/** 丸数字の始まり（①）。⑳ まである。 */
const CIRCLED_ONE = 0x2460
const CIRCLED_MAX = 20

/** 帯の段の番号。**並んだ位置から**付ける（段が減っても番号が飛ばない）。⑳ を超えたら数字のまま。 */
export const stepNumber = (index: number): string =>
  index >= 0 && index < CIRCLED_MAX ? String.fromCodePoint(CIRCLED_ONE + index) : String(index + 1)

/** 歌詞から置いたテロップの数（行の印 `lyricLine` があるもの。ADR-0033）。手で置いたテロップは数えない。 */
export const lyricTelopCountOf = (
  clips: readonly { readonly content: { readonly type: string; readonly params?: unknown } }[],
): number => clips.filter((clip) => clip.content.type === 'text' && lyricLineOf(clip.content.params) !== null).length

/** 次にやることを、押せる言葉で（ストーリーボードが空のときの主ボタンなど）。 */
export const WORKFLOW_ACTIONS: Readonly<Record<WorkflowStepId, string>> = {
  music: '楽曲を登録する',
  concept: '作品の方針を書く',
  lyrics: '歌詞の時刻を合わせる',
  telops: '歌詞をテロップにする',
  narration: 'ナレーションを入れる',
  shots: '区切って Shot にする',
  storyboard: '絵コンテを書く',
  frames: '絵を作る',
  takes: 'Take を作る',
  render: '書き出す',
}
