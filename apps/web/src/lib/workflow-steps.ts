/**
 * 制作の流れの帯（制作者 2026-10-01）。**React を含まない純粋な関数。**
 *
 * 音楽 → 作品の方針・歌詞 → 歌詞の時刻 → 区切る → Shot → 絵コンテ（説明）→ 絵（最初のフレーム）→ Take。
 * 歌詞の時刻は区切る前（制作者 2026-10-02「テロップみたいな、やり直しが容易にできるものを、ステップの前に持ってった方が効率的」）。
 * 区切ってから時刻を付けたら、境目が歌い出しより中央値 1.95 秒早くなり、絵と歌詞がずれた。
 * 「音楽 → 区切り → Shot → Take」と飛ばして、作品と関係ない映像ができた。各段が済んだか・途中か・
 * 次はどこかを決める。**分からない段は「分からない」のまま**にし、次の段として選ばない（L-021）。
 */

export type WorkflowStepId =
  | 'music'
  | 'concept'
  | 'lyrics'
  | 'cut'
  | 'shots'
  | 'storyboard'
  | 'frames'
  | 'takes'

/** `skipped` は要らない段（歌詞の無い曲の「歌詞の時刻」）。次の段に選ばない。 */
export type WorkflowStepState = 'done' | 'partial' | 'todo' | 'unknown' | 'skipped'

export type WorkflowStep = {
  readonly id: WorkflowStepId
  readonly label: string
  readonly state: WorkflowStepState
  /** Shot ごとに数える段だけ。Shot が無い・分からないときは null。 */
  readonly progress: { readonly done: number; readonly total: number } | null
}

export type WorkflowInput = {
  /** 楽曲（マスター）が登録されているか。 */
  readonly hasTrack: boolean
  /** コンセプト・あらすじ。**読めていなければ null**（空文字は「まだ書いていない」）。 */
  readonly concept: string | null
  /** 歌詞の行数（`lyricLines`）。0 なら歌詞の時刻の段は飛ばす。 */
  readonly lyricLineCount: number
  /** 時刻を付けた行の数（`lyricCues` の長さ。前から順に付く）。 */
  readonly lyricCueCount: number
  readonly shots: readonly {
    readonly description: string
    /** 最初のフレームが付いているか。**分からなければ null**（絵の一覧をまだ読めていない）。 */
    readonly hasStartFrame: boolean | null
    /** Take を採用しているか。 */
    readonly adopted: boolean
  }[]
}

const LABELS: Readonly<Record<WorkflowStepId, string>> = {
  music: '音楽',
  concept: '作品の方針・歌詞',
  lyrics: '歌詞の時刻',
  cut: '区切る',
  shots: 'Shot',
  storyboard: '絵コンテ',
  frames: '絵',
  takes: 'Take',
}

const flag = (id: WorkflowStepId, done: boolean | null): WorkflowStep => ({
  id,
  label: LABELS[id],
  state: done === null ? 'unknown' : done ? 'done' : 'todo',
  progress: null,
})

/** Shot ごとに数える段。1 件でも分からなければ件数を出さない。 */
const counted = (id: WorkflowStepId, marks: readonly (boolean | null)[]): WorkflowStep => {
  if (marks.length === 0) return { id, label: LABELS[id], state: 'todo', progress: null }
  if (marks.some((mark) => mark === null)) {
    return { id, label: LABELS[id], state: 'unknown', progress: null }
  }
  const done = marks.filter((mark) => mark === true).length
  return {
    id,
    label: LABELS[id],
    state: done === marks.length ? 'done' : done === 0 ? 'todo' : 'partial',
    progress: { done, total: marks.length },
  }
}

/** 歌詞の時刻。歌詞が無ければ飛ばす。行ごとに数える（前から順に付く）。 */
const lyricsStep = (lineCount: number, cueCount: number): WorkflowStep => {
  if (lineCount === 0) return { id: 'lyrics', label: LABELS.lyrics, state: 'skipped', progress: null }
  const done = Math.min(cueCount, lineCount)
  return {
    id: 'lyrics',
    label: LABELS.lyrics,
    state: done === lineCount ? 'done' : done === 0 ? 'todo' : 'partial',
    progress: { done, total: lineCount },
  }
}

export const workflowSteps = (
  input: WorkflowInput,
): { readonly steps: readonly WorkflowStep[]; readonly nextId: WorkflowStepId | null } => {
  // 区切りは「Shot にする」まで画面の中だけにある（保存されない）ので、区切ったかは Shot の有無で見る。
  const hasShots = input.shots.length > 0
  const steps: readonly WorkflowStep[] = [
    flag('music', input.hasTrack),
    flag('concept', input.concept === null ? null : input.concept.trim() !== ''),
    lyricsStep(input.lyricLineCount, input.lyricCueCount),
    flag('cut', hasShots),
    flag('shots', hasShots),
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
  ]
  const next = steps.find((step) => step.state === 'todo' || step.state === 'partial')
  return { steps, nextId: next?.id ?? null }
}
