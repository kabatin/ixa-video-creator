import type { Seconds, TimelineDocument } from '@ixa/domain'
import { TIME_EPSILON } from './ordering.js'

/**
 * タイムラインを区間で切る（制作者 2026-10-02「途中までを誰かに見せたい時のために選択した Shot だけを動画として出力」）。
 * **純粋な関数のみ。**
 *
 * 区間に掛かる VIDEO1・クリップ・音を残し、頭を 0 秒へずらし、端で切る。
 * - 動画の Shot を頭で切ったら、素材の切り出し位置を `切った秒 × 再生速度` だけ進める。絵は止まっているので進めない
 * - 素材のクリップも切り出し位置を合わせる（頭で切れば inSec を進め、尻で切れば outSec を戻す）
 * - 音はその区間の音から鳴らす（`inSec` を進める）
 * - トランジションは前後の Shot が両方残るものだけ
 */

export type TimelineRange = { readonly startSec: Seconds; readonly endSec: Seconds }

type Span = { readonly startSec: Seconds; readonly durationSec: Seconds }

/** 区間に掛かる部分。掛からない（端で触れるだけも）なら null。`head` は頭で切った秒。 */
const cut = (span: Span, range: TimelineRange): { readonly span: Span; readonly head: Seconds; readonly tail: Seconds } | null => {
  const start = Math.max(span.startSec, range.startSec)
  const end = Math.min(span.startSec + span.durationSec, range.endSec)
  if (end - start <= TIME_EPSILON) return null
  return {
    span: { startSec: start - range.startSec, durationSec: end - start },
    head: start - span.startSec,
    tail: span.startSec + span.durationSec - end,
  }
}

/** 区間を切れない理由（逆・空・尺の外）。切れるなら null。API の入力の検査もこれを使う（規則を 2 か所に書かない）。 */
export const timelineRangeProblem = (durationSec: Seconds, range: TimelineRange): string | null => {
  const { startSec, endSec } = range
  if (startSec >= -TIME_EPSILON && endSec <= durationSec + TIME_EPSILON && endSec - startSec > TIME_EPSILON) return null
  return `書き出す区間が正しくありません（${startSec.toFixed(2)}–${endSec.toFixed(2)} 秒。尺は ${durationSec.toFixed(2)} 秒）`
}

/** 区間に掛かるか（端で触れるだけは掛からない）。 */
export const overlapsRange = (span: Span, range: TimelineRange): boolean => cut(span, range) !== null

const assertRange = (doc: TimelineDocument, range: TimelineRange): void => {
  const problem = timelineRangeProblem(doc.durationSec, range)
  if (problem !== null) throw new Error(problem)
}

export const sliceTimelineDocument = (doc: TimelineDocument, range: TimelineRange): TimelineDocument => {
  assertRange(doc, range)

  const video1 = doc.video1.flatMap((shot) => {
    const piece = cut(shot, range)
    if (piece === null) return []
    const advance = shot.kind === 'image' ? 0 : piece.head * (shot.playbackRate ?? 1)
    return [{ ...shot, ...piece.span, inSec: shot.inSec + advance }]
  })

  const kept = new Set(video1.map((shot) => shot.shotId))
  const transitions = doc.transitions.filter(
    (transition) => kept.has(transition.fromShotId) && kept.has(transition.toShotId),
  )

  const clips = doc.clips.flatMap((clip) => {
    const piece = cut(clip, range)
    if (piece === null) return []
    const content =
      clip.content.type === 'media'
        ? { ...clip.content, inSec: clip.content.inSec + piece.head, outSec: clip.content.outSec - piece.tail }
        : clip.content
    return [{ ...clip, ...piece.span, content }]
  })

  const audio = doc.audio.flatMap((track) => {
    const piece = cut(track, range)
    if (piece === null) return []
    return [{ ...track, ...piece.span, inSec: (track.inSec ?? 0) + piece.head }]
  })

  return { ...doc, durationSec: range.endSec - range.startSec, video1, transitions, clips, audio }
}
