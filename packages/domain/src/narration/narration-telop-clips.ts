import type { ProjectId, TextStyleId } from '../common/ids.js'
import type { CreateTimelineClipInput } from '../timeline/timeline.js'
import type { TextStyle } from '../timeline/text-style.js'
import { MAX_TEXT_CLIP_LENGTH, MIN_TEXT_CLIP_DURATION_SEC } from '../timeline/text-template.js'
import type { CharTime } from './char-timing.js'
import { lineReading, type NarrationLine } from './narration-line.js'
import type { NarrationTake } from './narration-take.js'
import { narrationTelopSpans, type NarrationTelopSource } from './narration-telops.js'
import type { ReadingEntry } from './reading.js'
import { displaySpeechWeights } from './speech-estimate.js'
import { splitTelopText, timeTelopChunks } from './telop-chunks.js'

/**
 * ナレーションのテロップ（ADR-0038）。行の表示を句読点で分け、声の長さ（字の時刻があればそれ）で時刻を付けて、
 * タイムラインのテロップにする。**テロップは導かれるもの**（字を直すのは行の表示で。テロップを直しても次に作り直される）。
 */

/** ナレーションのテロップの層。手で置くテロップ（0）・歌詞（1）とぶつからない。 */
export const NARRATION_TELOP_LAYER = 2

/** この名前で保存したテロップの見た目があれば、ナレーションのテロップはその見た目にする。 */
export const NARRATION_STYLE_NAME = 'ナレーション'

/** 保存した見た目が無いときの見た目。下寄せの帯（歌詞は中央に出るので重ならない）。 */
export const DEFAULT_NARRATION_TEXT_STYLE: TextStyle = Object.freeze({
  anchor: 'bottom-center',
  weight: 'bold',
  color: '#ffffff',
  background: { color: '#000000', opacity: 0.45 },
})

/** 話している字を強調する既定の色。 */
export const DEFAULT_HIGHLIGHT_COLOR = '#ffd400'

export type NarrationTelopLine = {
  readonly line: Pick<NarrationLine, 'id' | 'text' | 'reading' | 'startSec' | 'telop'>
  /** 選んだ声の Take。無ければテロップを作らない。 */
  readonly take: Pick<NarrationTake, 'inSec' | 'outSec' | 'charTimes'> | null
  /** その行の見た目（声の見た目・「ナレーション」の見た目・既定のどれか）。 */
  readonly style: { readonly style: TextStyle; readonly styleId: TextStyleId | null }
}

export type NarrationTelopInput = {
  readonly projectId: ProjectId
  readonly lines: readonly NarrationTelopLine[]
  readonly dictionary: readonly ReadingEntry[]
  readonly highlight: { readonly enabled: boolean; readonly color: string }
}

/** 字の時刻が今の表示と字数で合うときだけ使う（声を作った後に表示を直していれば合わない）。 */
const timesFor = (text: string, charTimes: readonly CharTime[] | null): readonly CharTime[] | null =>
  charTimes !== null && charTimes.length === [...text].length ? charTimes : null

export const narrationTelopClips = (input: NarrationTelopInput): readonly CreateTimelineClipInput[] => {
  const usable = input.lines.flatMap((entry) =>
    entry.line.telop && entry.line.startSec !== null && entry.take !== null ? [{ ...entry, startSec: entry.line.startSec, take: entry.take }] : [],
  )
  const sources: readonly NarrationTelopSource[] = usable.map((entry) => {
    const display = entry.line.text
    return {
      lineId: entry.line.id,
      startSec: entry.startSec,
      chunks: timeTelopChunks({
        display,
        chunks: splitTelopText(display),
        durationSec: entry.take.outSec - entry.take.inSec,
        displayTimes: timesFor(display, entry.take.charTimes),
        weights: displaySpeechWeights(lineReading(entry.line, input.dictionary)),
      }),
    }
  })
  const styleOf = new Map(usable.map((entry) => [entry.line.id as string, entry.style]))
  return narrationTelopSpans(sources)
    .filter((span) => [...span.text].length <= MAX_TEXT_CLIP_LENGTH)
    .map((span) => {
      const look = styleOf.get(span.lineId) ?? { style: DEFAULT_NARRATION_TEXT_STYLE, styleId: null }
      return {
        projectId: input.projectId,
        track: 'TEXT' as const,
        startSec: span.startSec,
        durationSec: Math.max(span.durationSec, MIN_TEXT_CLIP_DURATION_SEC),
        layer: NARRATION_TELOP_LAYER,
        opacity: 1,
        content: {
          type: 'text' as const,
          templateKey: 'plain',
          params: {
            text: span.text,
            narrationLineId: span.lineId,
            style: look.style,
            ...(look.styleId === null ? {} : { styleId: look.styleId }),
            ...(input.highlight.enabled && span.chars !== null ? { highlight: { color: input.highlight.color, chars: span.chars } } : {}),
          },
        },
      }
    })
}
