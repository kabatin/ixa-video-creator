import type { TimelineClip } from '@ixa/domain'

/**
 * 「＋テロップ」で置く場所（制作者 2026-10-19）。**React を含まない。**
 *
 * 再生位置から 2 秒。その時間に既にテロップがあれば、空いている段に重ねる
 * （下から順に探し、全部埋まっていればいちばん上の次の段。帯の空いた段 `textLanesWithSpare` と同じ考え）。
 * 曲の終わり間際なら終わりに収まるよう前へずらす。
 */

export const QUICK_TEXT_DURATION_SEC = 2
/** 置いた直後の文字。すぐインスペクターで打ち直す前提の仮の文字。 */
export const QUICK_TEXT_LABEL = 'テロップ'

/** 接しているだけの端を重なりにしない許容（`timeline-insert.ts` の重なりの判定と同じ）。 */
const TIME_EPSILON = 1e-6

export type QuickTextPlan = {
  readonly startSec: number
  readonly durationSec: number
  readonly layer: number
}

const overlaps = (clip: TimelineClip, startSec: number, endSec: number): boolean =>
  startSec < clip.startSec + clip.durationSec - TIME_EPSILON && endSec > clip.startSec + TIME_EPSILON

const spanAt = (atSec: number, programEndSec: number): Omit<QuickTextPlan, 'layer'> => {
  const at = Math.max(0, atSec)
  // 尺が分からないときは位置どおり。はみ出しは書き出しの検査が警告で知らせる。
  if (programEndSec <= 0) return { startSec: at, durationSec: QUICK_TEXT_DURATION_SEC }
  if (programEndSec <= QUICK_TEXT_DURATION_SEC) return { startSec: 0, durationSec: programEndSec }
  return { startSec: Math.min(at, programEndSec - QUICK_TEXT_DURATION_SEC), durationSec: QUICK_TEXT_DURATION_SEC }
}

export const planQuickText = (args: {
  readonly clips: readonly TimelineClip[]
  readonly atSec: number
  readonly programEndSec: number
}): QuickTextPlan => {
  const span = spanAt(args.atSec, args.programEndSec)
  const endSec = span.startSec + span.durationSec
  const texts = args.clips.filter((clip) => clip.track === 'TEXT')
  const top = texts.reduce((max, clip) => Math.max(max, clip.layer), -1)
  const layers = Array.from({ length: top + 2 }, (_, index) => index)
  const layer =
    layers.find((candidate) =>
      texts.every((clip) => clip.layer !== candidate || !overlaps(clip, span.startSec, endSec)),
    ) ?? top + 1
  return { ...span, layer }
}
