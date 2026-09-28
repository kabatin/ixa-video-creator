import type { TimelineClip } from '@ixa/domain'
import { readTextClipParams } from '@/lib/text-style-form'
import { validateTextClipInsert } from '@/lib/timeline-insert'

/** 開始と尺の欄が出す理由。文字や型の理由はここでは扱わない（直しているのは時間だけ）。 */
const SPAN_FIELDS: readonly string[] = ['startSec', 'durationSec']

/**
 * インスペクターでテロップの開始・尺を直すときの検査。返すのは最初の理由、null なら保存してよい。
 *
 * **帯の小窓と同じ規則で見る**（`validateTextClipInsert`）。重なり・短すぎる尺の規則を
 * 画面ごとに書き写すと、片方だけ直ってずれる。文字や型が読めないテロップでも時間は直せるよう、
 * 時間の欄の理由だけを拾う。
 */
export const textClipSpanIssue = (args: {
  readonly clips: readonly TimelineClip[]
  readonly clip: TimelineClip
  readonly programEndSec: number
  readonly startSec: number
  readonly durationSec: number
}): string | null => {
  const { clip } = args
  const result = validateTextClipInsert({
    // 自分自身は重なりの相手にしない。直しているのだから当然ぶつかる。
    clips: args.clips.filter((candidate) => candidate.id !== clip.id),
    track: clip.track,
    layer: clip.layer,
    programEndSec: args.programEndSec,
    draft: {
      templateKey: clip.content.type === 'text' ? clip.content.templateKey : '',
      text: readTextClipParams(clip.content.type === 'text' ? clip.content.params : null)?.text ?? '',
      startSec: String(args.startSec),
      durationSec: String(args.durationSec),
    },
  })
  if (result.ok) return null
  return result.issues.find((issue) => SPAN_FIELDS.includes(issue.field))?.message ?? null
}
