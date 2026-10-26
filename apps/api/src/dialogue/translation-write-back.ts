import type { ShotRepository } from '@ixa/db'
import {
  MAX_TEXT_CLIP_TRANSLATION_LENGTH,
  dialogueTelopOf,
  type DialogueLine,
  type EditBatchEntry,
  type ShotId,
  type TimelineClip,
  type TimelineClipContent,
} from '@ixa/domain'

/**
 * セリフの字幕の訳文を直したら、Shot の行の訳文へ書き戻す（ADR-0061）。**訳文の正は行**で、字幕は行から導かれる
 * （書き戻さないと、次の作り直しで直した訳文が消える）。画面のテロップの欄からも MCP の `edit_clips` からも
 * `PATCH /clips/{id}` を通るので、ここ 1 か所で書き戻す。
 *
 * 取り消しは同じ記録に Shot の行の「変える前」を入れて戻す（テロップだけ戻ると、行の訳文で作り直されて戻らない）。
 */

export type TranslationWriteBack = {
  readonly shotId: ShotId
  readonly dialogue: readonly DialogueLine[]
  /** 取り消しの記録（変える前の行）。 */
  readonly entry: EditBatchEntry
}

/** 訳文の読み方。空・空白だけ・文字でないものは「訳文なし」。 */
const translationOf = (params: unknown): string | null => {
  const value = typeof params === 'object' && params !== null ? (params as { readonly translation?: unknown }).translation : undefined
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 書き戻す内容。セリフの字幕でない・訳文を変えていない・行が無い（消された・行が減った）なら null（何もしない）。
 * **書かない。** 書くのは呼ぶ側（記録と同じトランザクションで）。
 */
export const planTranslationWriteBack = async (
  shots: Pick<ShotRepository, 'findById'>,
  existing: TimelineClip,
  nextContent: TimelineClipContent | undefined,
): Promise<TranslationWriteBack | null> => {
  if (existing.content.type !== 'text' || nextContent?.type !== 'text') return null
  const mark = dialogueTelopOf(existing.content.params)
  if (mark === null) return null
  const next = translationOf(nextContent.params)
  if (next === translationOf(existing.content.params)) return null
  const shot = await shots.findById(mark.shotId)
  const line = shot?.dialogue[mark.lineIndex]
  if (shot === null || line === undefined || line.translation === next) return null
  return {
    shotId: shot.id,
    dialogue: shot.dialogue.map((each, i) => (i === mark.lineIndex ? { ...each, translation: next } : each)),
    entry: { shotId: shot.id, patch: { dialogue: shot.dialogue } },
  }
}

export const TRANSLATION_TOO_LONG_MESSAGE = `訳文は ${String(MAX_TEXT_CLIP_TRANSLATION_LENGTH)} 文字までにしてください`
export const TRANSLATION_NOT_TEXT_MESSAGE = '訳文は文字で入れてください'

/**
 * テロップの訳文（2 段字幕の下の段）を、保存する形にそろえる。**空・空白だけは「訳文なし」として鍵ごと外す**
 * （画面で欄を空にすると "" が来る）。前後の空白は落とす。文字でない・長すぎる訳文は保存の時点で弾く
 * （描く側は読めない訳文を捨てるので、保存させると「入れたのに出ない」になる）。
 */
export const normalizeTextTranslation = <T extends { readonly content?: TimelineClipContent }>(
  input: T,
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly fields: Readonly<Record<string, string[]>> } => {
  const { content } = input
  if (content?.type !== 'text' || content.params === undefined || !('translation' in content.params)) return { ok: true, value: input }
  const { translation, ...rest } = content.params
  if (typeof translation !== 'string') return { ok: false, fields: { 'content.params.translation': [TRANSLATION_NOT_TEXT_MESSAGE] } }
  const trimmed = translation.trim()
  if (trimmed.length > MAX_TEXT_CLIP_TRANSLATION_LENGTH) {
    return { ok: false, fields: { 'content.params.translation': [TRANSLATION_TOO_LONG_MESSAGE] } }
  }
  return { ok: true, value: { ...input, content: { ...content, params: trimmed === '' ? rest : { ...rest, translation: trimmed } } } }
}
