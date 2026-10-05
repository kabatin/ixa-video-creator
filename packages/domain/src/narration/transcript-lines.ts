import type { CharTime } from './char-timing.js'

/**
 * 録音の文字起こしを、原稿の行に分ける（ADR-0038）。
 * 分けるのは句点（。！？）と、長い間（話していない時間）。長すぎる行は上限の字数で分ける（読点があればそこで）。
 */

/** これ以上話していなければ、行を分ける。 */
export const TRANSCRIPT_LINE_PAUSE_SEC = 0.6
/** 1 行の字数の上限（原稿の行の上限より短く、テロップ数枚に収まる長さ）。 */
export const TRANSCRIPT_LINE_MAX_CHARS = 80

const SENTENCE_END = /[。．！？!?]/u
const CLAUSE_END = /[、,，]/u

export type TranscribedLine = {
  readonly text: string
  /** 録音の中の秒。 */
  readonly startSec: number
  readonly endSec: number
  /** 字の時刻（行の頭からの秒）。 */
  readonly chars: readonly CharTime[]
}

const roundMs = (seconds: number): number => Math.round(seconds * 1000) / 1000

/** 句点と長い間で分ける。 */
const splitAtBreaks = (chars: readonly CharTime[], pauseSec: number): readonly (readonly CharTime[])[] =>
  chars.reduce<readonly (readonly CharTime[])[]>((groups, char) => {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    const startsNew =
      current === undefined ||
      previous === undefined ||
      SENTENCE_END.test(previous.char) ||
      char.startSec - previous.endSec >= pauseSec
    return startsNew ? [...groups, [char]] : [...groups.slice(0, -1), [...current, char]]
  }, [])

/** 長すぎる並びを上限で分ける。上限の中に読点があれば、いちばん後ろの読点の後で切る。 */
const splitLong = (group: readonly CharTime[], maxChars: number): readonly (readonly CharTime[])[] => {
  if (group.length <= maxChars) return [group]
  const head = group.slice(0, maxChars)
  const lastClause = head.findLastIndex((char) => CLAUSE_END.test(char.char))
  const cut = lastClause >= 0 ? lastClause + 1 : maxChars
  return [group.slice(0, cut), ...splitLong(group.slice(cut), maxChars)]
}

/** 前後の空白を落とす。 */
const trim = (group: readonly CharTime[]): readonly CharTime[] => {
  const first = group.findIndex((char) => char.char.trim() !== '')
  if (first === -1) return []
  const last = group.findLastIndex((char) => char.char.trim() !== '')
  return group.slice(first, last + 1)
}

export const linesFromTranscript = (
  chars: readonly CharTime[],
  options: { readonly pauseSec?: number; readonly maxChars?: number } = {},
): readonly TranscribedLine[] =>
  splitAtBreaks(chars, options.pauseSec ?? TRANSCRIPT_LINE_PAUSE_SEC)
    .flatMap((group) => splitLong(trim(group), options.maxChars ?? TRANSCRIPT_LINE_MAX_CHARS))
    .map(trim)
    .filter((group) => group.length > 0)
    .map((group) => {
      const startSec = group[0]?.startSec ?? 0
      return {
        text: group.map((char) => char.char).join(''),
        startSec: roundMs(startSec),
        endSec: roundMs(group.at(-1)?.endSec ?? startSec),
        chars: group.map((char) => ({ char: char.char, startSec: char.startSec - startSec, endSec: char.endSec - startSec })),
      }
    })
