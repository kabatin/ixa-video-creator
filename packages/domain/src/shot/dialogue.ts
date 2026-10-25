import { z } from 'zod'
import { CharacterId } from '../common/ids.js'

/**
 * Shot のセリフ（ADR-0059）。1 行 = 1 人が 1 回しゃべること。
 *
 * 話し手は作品のキャラクター。**配役（`shot_characters`）にいなくてもよい**
 * （画面の外から声だけ届く「画面外の声」があるため）。
 */

/** 1 行のセリフの上限（文字）。10 秒に 3〜4 行が目安なので、1 行がこれより長いことはまず無い。 */
export const MAX_DIALOGUE_TEXT_LENGTH = 200
/** 訳文（段 3 の 2 段字幕の下の段）の上限（文字）。英語は日本語より長くなるので倍にしてある。 */
export const MAX_DIALOGUE_TRANSLATION_LENGTH = 400
/**
 * 1 Shot の行の上限。**止める上限**で、目安ではない（目安は `DIALOGUE_WARNING_LINES`）。
 * 書き間違いで数百行が入り、H3 の文面の上限を超えて投入で落ちるのを、保存の時点で止める。
 */
export const MAX_DIALOGUE_LINES = 20
/**
 * この行数から「長すぎます」と言う。H3 は 10 秒に 3〜4 行までしか口と声が合わない。
 * **止めはしない**（短い相づちを重ねる演出もある）。
 */
export const DIALOGUE_WARNING_LINES = 5

export const DialogueLine = z
  .object({
    speakerId: CharacterId,
    text: z.string().trim().min(1, 'セリフが空です').max(MAX_DIALOGUE_TEXT_LENGTH),
    /** 画面外の声。話し手は映っておらず、映っている人の口は閉じたまま。 */
    offscreen: z.boolean().default(false),
    /** 訳文（段 3 で使う）。空は null に揃える。 */
    translation: z
      .string()
      .trim()
      .max(MAX_DIALOGUE_TRANSLATION_LENGTH)
      .nullable()
      .default(null)
      .transform((value) => (value === null || value === '' ? null : value)),
  })
  .strict()
export type DialogueLine = z.infer<typeof DialogueLine>

export const DialogueLines = z.array(DialogueLine).max(MAX_DIALOGUE_LINES)
export type DialogueLines = z.infer<typeof DialogueLines>

export type DialogueWarning = {
  readonly code: 'too_many_lines'
  readonly message: string
}

/** 保存はできるが、作る前に知らせたいこと。API の応答・MCP の結果・画面が同じものを出す。 */
export const dialogueWarnings = (lines: readonly DialogueLine[]): readonly DialogueWarning[] =>
  lines.length >= DIALOGUE_WARNING_LINES
    ? [{ code: 'too_many_lines', message: '長すぎます（10 秒に 3〜4 行まで）' }]
    : []

/**
 * 自動レビューの指示文に入れる形（「話し手: セリフ」を 1 行ずつ）。行が無ければ null。
 * 名前を引けない話し手は「話し手不明」にする（ID を指示文に出さない）。
 */
export const formatDialogueForReview = (
  lines: readonly DialogueLine[],
  nameOf: (id: CharacterId) => string | null,
): string | null => {
  if (lines.length === 0) return null
  return lines
    .map((line) => {
      const name = nameOf(line.speakerId) ?? '話し手不明'
      return `${name}${line.offscreen ? '（画面外）' : ''}: ${line.text}`
    })
    .join('\n')
}
