import { MIN_TEXT_CLIP_DURATION_SEC } from '../timeline/text-template.js'

/**
 * 歌詞（制作者 2026-10-01「歌詞は明確に入力するところを設けたい」「1 フレーズごとにテロップを自動生成」）。
 *
 * - 1 行 = 1 フレーズ。空行は歌の区切りで、フレーズに数えない
 * - 時刻（`Project.lyricCues`）は行ごとの歌い出しの秒（float、規約 3）。聴きながら Enter で打つ。
 *   前から順に付ける（付いていない行は、まだ合わせていない）
 */

/** 歌詞から置くテロップの層。手で置くテロップ（0 層）とぶつからず、帯でも別の段に出る。 */
export const LYRIC_TELOP_LAYER = 1

/** この名前で保存したテロップのスタイルがあれば、歌詞のテロップはその見た目で置く。 */
export const LYRIC_STYLE_NAME = '歌詞'

/** テロップを出し続ける上限。間奏で次のフレーズまで長く空くとき、ずっと残さない。 */
export const LYRIC_TELOP_MAX_SEC = 6

/** 歌詞をフレーズに分ける。前後の空白と空行（歌の区切り）を落とす。 */
export const lyricLines = (lyrics: string): readonly string[] =>
  lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** 時刻の並びの問題。無ければ null。**行の順に増えていく 0 以上の秒**だけを受け付ける。 */
export const lyricCuesProblem = (cues: readonly number[]): string | null => {
  if (cues.some((cue) => !Number.isFinite(cue) || cue < 0)) {
    return '歌詞の時刻は 0 以上の秒で入れてください'
  }
  const backwards = cues.some((cue, index) => index > 0 && cue <= (cues[index - 1] ?? -1))
  return backwards ? '歌詞の時刻は、行の順に後ろへ進む必要があります' : null
}

export type LyricTelopSpan = {
  readonly lineIndex: number
  readonly text: string
  readonly startSec: number
  readonly durationSec: number
}

/**
 * 時刻の付いたフレーズをテロップの区間にする。**次のフレーズの頭まで**出す（最後は曲の終わりまで）。
 * 間奏で長く空くときは `LYRIC_TELOP_MAX_SEC` で切る。読めないほど短い（テロップの最短未満）フレーズと、
 * 曲の終わりより後のフレーズは置かない。
 */
export const lyricTelopSpans = (
  lines: readonly string[],
  cues: readonly number[],
  endSec: number,
): readonly LyricTelopSpan[] =>
  cues.flatMap((startSec, lineIndex) => {
    const text = lines[lineIndex]
    if (text === undefined || startSec >= endSec) return []
    const until = Math.min(cues[lineIndex + 1] ?? endSec, endSec, startSec + LYRIC_TELOP_MAX_SEC)
    const durationSec = until - startSec
    return durationSec < MIN_TEXT_CLIP_DURATION_SEC ? [] : [{ lineIndex, text, startSec, durationSec }]
  })

/** その区間（Shot）の間に歌い出すフレーズ。絵コンテの案に「この Shot で歌われる歌詞」として渡す。 */
export const lyricsDuring = (
  lines: readonly string[],
  cues: readonly number[],
  span: { readonly startSec: number; readonly durationSec: number },
): readonly string[] =>
  cues.flatMap((cue, index) => {
    const text = lines[index]
    return text !== undefined && cue >= span.startSec && cue < span.startSec + span.durationSec ? [text] : []
  })
