import type { ProjectId } from '../common/ids.js'
import type { SpeechSegment } from '../media/media-asset.js'
import { DEFAULT_NARRATION_TEXT_STYLE, NARRATION_TELOP_LAYER } from '../narration/narration-telop-clips.js'
import type { TextStyle } from '../timeline/text-style.js'
import {
  MAX_TEXT_CLIP_LENGTH,
  MIN_TEXT_CLIP_DURATION_SEC,
  TextTemplateKey,
  dialogueTelopOf,
  parseTextClipParams,
  type DialogueTelopMark,
} from '../timeline/text-template.js'
import type { CreateTimelineClipInput, TimelineClip } from '../timeline/timeline.js'
import type { Shot } from './shot.js'

/**
 * セリフの字幕（ADR-0061）。Shot のセリフの行ごとに 1 枚のテロップを作る。**テロップは導かれるもの**
 * （字と訳文の正は Shot の行。テロップの訳文を直すと、api が行へ書き戻す）。
 *
 * 時刻の決め方:
 * - 採用 Take の音を鳴らす Shot で、話している区間（取り込みで測った `speechSegments`）の数が行の数と同じなら、行の順に当てる。
 * - それ以外（鳴らさない・測っていない・数が合わない）は、Shot の尺を行の文字数で割り振る。
 * - **手で直した時刻は保つ**（今の時刻が、同期が最後に置いた時刻 `placed` と違えば手の値）。
 */

/** セリフの字幕の層。ナレーションと同じ（手で置くテロップ 0・歌詞 1 とぶつからない）。 */
export const DIALOGUE_TELOP_LAYER = NARRATION_TELOP_LAYER

/** 当てた見た目が無いときの見た目。ナレーションと同じ下寄せの帯。 */
export const DEFAULT_DIALOGUE_TEXT_STYLE: TextStyle = DEFAULT_NARRATION_TEXT_STYLE

/** 画面に出ない区間を数えないための最短（秒）。切り出しの端で欠けた区間の切れ端を行に当てない。 */
const MIN_VISIBLE_SEGMENT_SEC = 0.05
const TIME_EPSILON = 1e-6

export type DialogueTelopShot = {
  readonly shot: Pick<Shot, 'id' | 'startSec' | 'durationSec' | 'sourceInSec' | 'dialogue'>
  /** 採用 Take の再生の速さ（`shotPlaybackRate`）。Take が無ければ 1。 */
  readonly playbackRate: number
  /** 話している区間（Take の頭からの秒）。音を鳴らさない・測っていない Take は null。 */
  readonly speech: readonly SpeechSegment[] | null
}

export type DialogueTelopInput = {
  readonly projectId: ProjectId
  readonly shots: readonly DialogueTelopShot[]
  /** 今あるセリフの字幕（見た目・型・手で直した時刻を引き継ぐ）。 */
  readonly existing: readonly TimelineClip[]
}

/** Shot の頭からの時刻。 */
export type DialogueLineSpan = { readonly offsetSec: number; readonly durationSec: number }

const round3 = (sec: number): number => Math.round(sec * 1000) / 1000

/** 話している区間を Shot の時刻に直す（切り出し位置と速さ）。画面に出ない区間は落とす。 */
const visibleSpeech = (entry: DialogueTelopShot): readonly DialogueLineSpan[] =>
  (entry.speech ?? []).flatMap((segment) => {
    const rate = entry.playbackRate > 0 ? entry.playbackRate : 1
    const start = Math.max(0, (segment.startSec - entry.shot.sourceInSec) / rate)
    const end = Math.min(entry.shot.durationSec, (segment.endSec - entry.shot.sourceInSec) / rate)
    return end - start >= MIN_VISIBLE_SEGMENT_SEC ? [{ offsetSec: round3(start), durationSec: round3(end - start) }] : []
  })

/** Shot の尺を行の文字数で割り振る。 */
const splitByLength = (entry: DialogueTelopShot): readonly DialogueLineSpan[] => {
  const weights = entry.shot.dialogue.map((line) => Math.max([...line.text].length, 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const edges = weights.reduce<readonly number[]>((acc, weight) => [...acc, (acc.at(-1) ?? 0) + weight], [0])
  return weights.map((_, i) => {
    const start = round3(((edges[i] ?? 0) / total) * entry.shot.durationSec)
    const end = round3(((edges[i + 1] ?? total) / total) * entry.shot.durationSec)
    return { offsetSec: start, durationSec: round3(end - start) }
  })
}

/** 行ごとの時刻（Shot の頭から）。区間の数が行の数と合えば区間、合わなければ割り振り。 */
export const dialogueLineSpans = (entry: DialogueTelopShot): readonly DialogueLineSpan[] => {
  const speech = visibleSpeech(entry)
  return speech.length === entry.shot.dialogue.length && speech.length > 0 ? speech : splitByLength(entry)
}

/** テロップに入る長さにする。入らなければ切って「…」を付ける（黙って捨てない）。 */
const telopText = (text: string): string => {
  const chars = [...text]
  return chars.length <= MAX_TEXT_CLIP_LENGTH ? text : `${chars.slice(0, MAX_TEXT_CLIP_LENGTH - 1).join('')}…`
}

const keyOf = (shotId: string, lineIndex: number): string => `${shotId}#${String(lineIndex)}`

type Carried = {
  readonly clip: TimelineClip
  readonly mark: DialogueTelopMark
}

/** 今ある字幕を (Shot, 行) で引けるようにする。同じ行に 2 枚あれば、頭の早いほうを使う。 */
const carriedByLine = (existing: readonly TimelineClip[]): ReadonlyMap<string, Carried> =>
  new Map(
    existing
      .flatMap((clip): readonly Carried[] => {
        const mark = clip.content.type === 'text' ? dialogueTelopOf(clip.content.params) : null
        return mark === null ? [] : [{ clip, mark }]
      })
      .sort((a, b) => b.clip.startSec - a.clip.startSec)
      .map((carried) => [keyOf(carried.mark.shotId, carried.mark.lineIndex), carried] as const),
  )

const handEdited = (carried: Carried): boolean =>
  Math.abs(carried.clip.startSec - carried.mark.placed.startSec) > TIME_EPSILON ||
  Math.abs(carried.clip.durationSec - carried.mark.placed.durationSec) > TIME_EPSILON

/** 引き継ぐ見た目と型。読めなければ既定。 */
const lookOf = (carried: Carried | undefined) => {
  const content = carried?.clip.content
  const params = content?.type === 'text' ? parseTextClipParams(content.params) : null
  const template = content?.type === 'text' ? TextTemplateKey.safeParse(content.templateKey) : null
  return {
    templateKey: template?.success === true ? template.data : 'plain',
    style: params?.style ?? DEFAULT_DIALOGUE_TEXT_STYLE,
    ...(params?.styleId === undefined || params.styleId === null ? {} : { styleId: params.styleId }),
  }
}

export const dialogueTelopClips = (input: DialogueTelopInput): readonly CreateTimelineClipInput[] => {
  const carried = carriedByLine(input.existing)
  return input.shots.flatMap((entry) => {
    const spans = dialogueLineSpans(entry)
    return entry.shot.dialogue.flatMap((line, lineIndex): readonly CreateTimelineClipInput[] => {
      const span = spans[lineIndex]
      if (span === undefined) return []
      const before = carried.get(keyOf(entry.shot.id, lineIndex))
      const auto = {
        startSec: round3(entry.shot.startSec + span.offsetSec),
        durationSec: Math.max(span.durationSec, MIN_TEXT_CLIP_DURATION_SEC),
      }
      const kept = before !== undefined && handEdited(before)
      const time = kept ? { startSec: before.clip.startSec, durationSec: before.clip.durationSec } : auto
      const placed = kept ? before.mark.placed : auto
      const { templateKey, ...look } = lookOf(before)
      return [
        {
          projectId: input.projectId,
          track: 'TEXT' as const,
          ...time,
          layer: DIALOGUE_TELOP_LAYER,
          opacity: 1,
          content: {
            type: 'text' as const,
            templateKey,
            params: {
              text: telopText(line.text),
              ...look,
              ...(line.translation === null ? {} : { translation: line.translation }),
              dialogue: { shotId: entry.shot.id, lineIndex, placed },
            },
          },
        },
      ]
    })
  })
}
