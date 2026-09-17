import { TextTemplateKey, type TimelineClip, type TimelineTrack } from '@ixa/domain'
import type { InlineFormAnchor, InlineFormDraft } from '@/components/timeline-inline-form'
import { TIME_DECIMALS } from '@/lib/format-time'
import type { TextInsertionProbe, TransitionInsertionPoint } from '@/lib/timeline-insert'
import { INSERTABLE_TRANSITION_TYPES } from '@/lib/timeline-insert'

/**
 * 帯の上で開いている入力の状態。**React を含まない。**
 *
 * 「何を開いているか」と「初期値をどう作るか」を 1 箇所に集める。
 * 画面側に散らすと、開く場所が増えるたびに初期値の作り方が枝分かれする。
 */

export type OpenInlineForm =
  | {
      readonly kind: 'transition'
      readonly point: TransitionInsertionPoint
      readonly anchor: InlineFormAnchor
    }
  | {
      readonly kind: 'text_insert'
      readonly track: TimelineTrack
      readonly layer: number
      readonly anchor: InlineFormAnchor
    }
  | {
      readonly kind: 'text_edit'
      readonly clip: TimelineClip
      readonly anchor: InlineFormAnchor
    }

const seconds = (value: number): string => value.toFixed(TIME_DECIMALS)

/**
 * 既にあるトランジションを開いたら**その値から始める**。
 * 空から始めると、直したいだけなのに選び直しになる。
 */
export const transitionDraft = (point: TransitionInsertionPoint): InlineFormDraft => ({
  kind: 'transition',
  type: point.existing?.type ?? INSERTABLE_TRANSITION_TYPES[0] ?? 'dissolve',
  durationSec: seconds(point.existing?.durationSec ?? point.defaultDurationSec),
})

/**
 * これから置くテロップの初期値。
 *
 * **文字は空文字であって `null` ではない。** `null` は「保存されていたが読めなかった」を
 * 意味し、入力欄は「このまま送ると元の文字を上書きします」と断る。
 * まだ何も保存されていない新規の場所でそれを出すと、**ありもしない既存の中身を
 * 踏み潰す警告**になる。実際にそうなっていた。
 */
export const textInsertDraft = (probe: TextInsertionProbe): InlineFormDraft => ({
  kind: 'text',
  templateKey: 'lower_third',
  text: '',
  startSec: seconds(probe.ok ? probe.span.startSec : 0),
  durationSec: seconds(probe.ok ? probe.span.durationSec : 0),
})

/**
 * 既にあるテロップを開くときの初期値。
 *
 * **読めなかった値は `null` のまま渡す。** 既定へ倒して空欄で開くと、
 * 「空のテロップ」と「壊れて読めないテロップ」が同じ見た目になり、
 * 送った瞬間に古い内容を黙って踏み潰す。断りを出すのは入力部品の仕事で、
 * ここは読めたか読めなかったかを正直に伝えるだけにする（lessons L-015）。
 */
export const textEditDraft = (clip: TimelineClip): InlineFormDraft => {
  const content = clip.content
  const span = { startSec: seconds(clip.startSec), durationSec: seconds(clip.durationSec) }

  if (content.type !== 'text') {
    return { kind: 'text', templateKey: null, text: null, ...span }
  }

  const template = TextTemplateKey.safeParse(content.templateKey)
  const raw: unknown = content.params.text
  const readable = typeof raw === 'string' && raw.trim().length > 0

  return {
    kind: 'text',
    templateKey: template.success ? template.data : null,
    ...(template.success ? {} : { rawTemplateKey: content.templateKey }),
    text: readable ? raw : null,
    ...span,
  }
}

/** 開いている場所の説明。どこを触っているか分からないまま送らせない。 */
export const openFormCaption = (open: OpenInlineForm): string => {
  switch (open.kind) {
    case 'transition':
      return open.point.message
    case 'text_insert':
      return `${open.track} トラック layer ${String(open.layer)} にテロップを挿す`
    case 'text_edit':
      return 'このテロップを直す'
  }
}
