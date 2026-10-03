import { lyricLineOf } from '@ixa/domain'

/**
 * 制作の流れの帯（制作者 2026-10-01）。**React を含まない純粋な関数。**
 *
 * 楽曲 → 作品の方針（方針・歌詞・ルック）→ 歌詞の時刻 → テロップ → 区切って Shot → 絵コンテ（説明）→
 * 絵（最初のフレーム）→ Take → 書き出す（2026-10-03 に並べ直した）。
 * - 歌詞の時刻とテロップは区切る前（制作者 2026-10-02「テロップみたいな、やり直しが容易にできるものを、ステップの前に
 *   持ってった方が効率的」、2026-10-03「まずはテロップのタイミングをセット」）。テロップは黒い画面で、絵を作らずに確かめられる
 * - 区切ってから時刻を付けたら、境目が歌い出しより中央値 1.95 秒早くなり、絵と歌詞がずれた
 * - 区切りは「Shot にする」まで保存されないので、区切ると Shot は 1 つの段にした（区切ったかは Shot の有無でしか分からない）
 *
 * 「音楽 → 区切り → Shot → Take」と飛ばして、作品と関係ない映像ができた。各段が済んだか・途中か・
 * 次はどこかを決める。**分からない段は「分からない」のまま**にし、次の段として選ばない（L-021）。
 */

export type WorkflowStepId =
  | 'music'
  | 'concept'
  | 'lyrics'
  | 'telops'
  | 'shots'
  | 'storyboard'
  | 'frames'
  | 'takes'
  | 'render'

/** `skipped` は要らない段（歌詞の無い曲の「歌詞の時刻」「テロップ」）。次の段に選ばない。 */
export type WorkflowStepState = 'done' | 'partial' | 'todo' | 'unknown' | 'skipped'

export type WorkflowStep = {
  readonly id: WorkflowStepId
  readonly label: string
  readonly state: WorkflowStepState
  /** 数えて途中を出す段だけ。数えられないときは null。 */
  readonly progress: { readonly done: number; readonly total: number } | null
}

export type WorkflowInput = {
  /** 楽曲（マスター）が登録されているか。 */
  readonly hasTrack: boolean
  /** コンセプト・あらすじ。**読めていなければ null**（空文字は「まだ書いていない」）。 */
  readonly concept: string | null
  /** ルック（画風・光・質感）を書いたか。 */
  readonly hasLook: boolean
  /** 歌詞なしの作品か（作品の方針でチェックする）。歌詞の時刻とテロップの段を飛ばし、方針は方針・ルックで数える。 */
  readonly instrumental: boolean
  /** 歌詞の行数（`lyricLines`）。0 なら歌詞の時刻とテロップの段は飛ばす。 */
  readonly lyricLineCount: number
  /** 時刻を付けた行の数（`lyricCues` の長さ。前から順に付く）。 */
  readonly lyricCueCount: number
  /** 歌詞から置いたテロップの数。**読めていなければ null**。 */
  readonly lyricTelopCount: number | null
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
})

const skipped = (id: WorkflowStepId): WorkflowStep => ({ id, label: LABELS[id], state: 'skipped', progress: null })

/** 数え上げた段の状態。全部なら済み、0 ならまだ、その間は途中。 */
const tally = (id: WorkflowStepId, done: number, total: number): WorkflowStep => ({
  id,
  label: LABELS[id],
  state: done === total ? 'done' : done === 0 ? 'todo' : 'partial',
  progress: { done, total },
})

/** Shot ごとに数える段。1 件でも分からなければ件数を出さない。 */
const counted = (id: WorkflowStepId, marks: readonly (boolean | null)[]): WorkflowStep => {
  if (marks.length === 0) return { id, label: LABELS[id], state: 'todo', progress: null }
  if (marks.some((mark) => mark === null)) {
    return { id, label: LABELS[id], state: 'unknown', progress: null }
  }
  return tally(id, marks.filter((mark) => mark === true).length, marks.length)
}

/** 歌詞を使わない作品か（歌詞なしにした・歌詞がまだ 1 行も無い）。 */
const withoutLyrics = (input: WorkflowInput): boolean => input.instrumental || input.lyricLineCount === 0

/** 歌詞の時刻。歌詞を使わなければ飛ばす。行ごとに数える（前から順に付く）。 */
const lyricsStep = (input: WorkflowInput): WorkflowStep =>
  withoutLyrics(input)
    ? skipped('lyrics')
    : tally('lyrics', Math.min(input.lyricCueCount, input.lyricLineCount), input.lyricLineCount)

/**
 * 作品の方針。方針（コンセプト・あらすじ）・歌詞・ルックの 3 つを数える
 * （制作者 2026-10-03「コンセプト・あらすじの入力、歌詞の入力、ルックの設定をさせたい」）。
 * 歌詞なしの作品は方針・ルックの 2 つ（制作者 2026-10-04「歌詞がない動画の場合、作品の方針が 2/3 でとまってしまう。
 * 歌詞なしのチェックボックスとかあるといいかも」）。
 */
const conceptStep = (input: WorkflowInput): WorkflowStep => {
  if (input.concept === null) return flag('concept', null)
  const parts = input.instrumental
    ? [input.concept.trim() !== '', input.hasLook]
    : [input.concept.trim() !== '', input.lyricLineCount > 0, input.hasLook]
  return tally('concept', parts.filter(Boolean).length, parts.length)
}

/** テロップ。歌詞を使わなければ飛ばす。歌詞から置いたテロップが 1 つでもあれば済み。 */
const telopsStep = (input: WorkflowInput): WorkflowStep =>
  withoutLyrics(input)
    ? skipped('telops')
    : flag('telops', input.lyricTelopCount === null ? null : input.lyricTelopCount > 0)

export const workflowSteps = (
  input: WorkflowInput,
): { readonly steps: readonly WorkflowStep[]; readonly nextId: WorkflowStepId | null } => {
  const steps: readonly WorkflowStep[] = [
    flag('music', input.hasTrack),
    conceptStep(input),
    lyricsStep(input),
    telopsStep(input),
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
  shots: '区切って Shot にする',
  storyboard: '絵コンテを書く',
  frames: '絵を作る',
  takes: 'Take を作る',
  render: '書き出す',
}
