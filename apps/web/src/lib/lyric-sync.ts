import { lyricCuesProblem, lyricLines } from '@ixa/domain'

/**
 * 歌詞を合わせる（ADR-0033。制作者 2026-10-01「聴きながら打つ」）。**React を含まない純粋な関数。**
 *
 * 曲を流し、フレーズの歌い出しで Enter（タップ）。Backspace で 1 つ戻す。後から 1 つずつ時刻を直せる。
 * 時刻の並びの規則は domain の `lyricCuesProblem`（行の順に後ろへ進む 0 以上の秒）。
 */

export type CueChange = { readonly cues: readonly number[] } | { readonly rejection: string }

/** 次のフレーズの歌い出しを打つ。最後まで打った・前のフレーズより前なら打たない（理由を返す）。 */
export const tapCue = (cues: readonly number[], lines: readonly string[], atSec: number): CueChange => {
  if (cues.length >= lines.length) return { rejection: '最後のフレーズまで合わせました。' }
  const last = cues.at(-1)
  if (last !== undefined && atSec <= last) {
    return { rejection: '前のフレーズより後で押してください。' }
  }
  return { cues: [...cues, atSec] }
}

/** 最後に打った 1 つを戻す。 */
export const undoCue = (cues: readonly number[]): readonly number[] => cues.slice(0, -1)

/** 1 つの時刻を直す。前後のフレーズを越えるなら直さない（順が崩れる）。 */
export const editCue = (cues: readonly number[], index: number, atSec: number): CueChange => {
  const next = cues.map((cue, at) => (at === index ? atSec : cue))
  const problem = lyricCuesProblem(next)
  return problem === null ? { cues: next } : { rejection: problem }
}

/** いま歌われているフレーズ（その時刻までに歌い出した最後の行）。まだなら -1。 */
export const currentLyricIndex = (cues: readonly number[], atSec: number): number =>
  cues.reduce((found, cue, index) => (cue <= atSec ? index : found), -1)

/** 作品の方針の歌詞の欄の下に出す 1 行。 */
export const lyricsSummary = (lyrics: string, cues: readonly number[]): string => {
  const count = lyricLines(lyrics).length
  if (count === 0) return '歌詞はまだありません。'
  const timed = Math.min(cues.length, count)
  if (timed === 0) return `${String(count)} フレーズ。時刻はまだ付いていません。`
  if (timed === count) return `${String(count)} フレーズ。すべてに時刻が付いています。`
  return `${String(count)} フレーズ。時刻は ${String(timed)} フレーズまで付いています。`
}
