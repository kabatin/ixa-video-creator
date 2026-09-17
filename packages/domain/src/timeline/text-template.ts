import { z } from 'zod'

/**
 * テロップの見せ方（テンプレート）。
 *
 * **`TRANSITION_SUPPORT` と同じ構えにしてある。**（`shot/shot.ts` の注記）
 * 画面・検証・レンダラの 3 箇所が同じ答えを見ないと、
 * **選べるのに絵に出ない**テンプレートが生まれる。実際に `wipe` がそうなっていた。
 *
 * テロップは以前 `templateKey` が自由入力で、レンダラは
 * `[text] lower-third` というプレースホルダを出すだけだった。
 * 文字そのものを持つ場所も無かったため、**何を打っても絵には出なかった。**
 */

export const TextTemplateKey = z.enum(['plain', 'lower_third'])
export type TextTemplateKey = z.infer<typeof TextTemplateKey>

/**
 * そのテンプレートを**実際に絵として出せるか**。
 *
 * `placeholder` は枠だけ出る状態を指す。中途半端な近似で「出ているように見える」より、
 * 出ていないと分かるほうがよい。
 */
export const TEXT_TEMPLATE_SUPPORT: Readonly<Record<TextTemplateKey, 'implemented' | 'placeholder'>> =
  Object.freeze({
    /** 画面の中央に文字を置くだけ。飾りは無い。 */
    plain: 'implemented',
    /** 下寄せの帯に載せる。よくある字幕の形。 */
    lower_third: 'implemented',
  })

/** 絵に出ないテンプレートか。画面はこれを見て注意を出す。 */
export const isPlaceholderTextTemplate = (key: TextTemplateKey): boolean =>
  TEXT_TEMPLATE_SUPPORT[key] === 'placeholder'

/** テロップに入れられる文字数の上限。長文は画面からはみ出して読めなくなる。 */
export const MAX_TEXT_CLIP_LENGTH = 120

/**
 * テロップの中身。`TimelineClip.content.params` に入る。
 *
 * `params` は `Record<string, unknown>` なので、**形の正はここだけが持つ。**
 * 読む側（レンダラ・画面）は必ずこのスキーマを通す。
 */
export const TextClipParams = z.object({
  /** 出す文字。空のテロップは置けない。 */
  text: z.string().trim().min(1, 'テロップの文字を入れてください').max(MAX_TEXT_CLIP_LENGTH),
})
export type TextClipParams = z.infer<typeof TextClipParams>

/**
 * `params` からテロップの中身を取り出す。
 *
 * **読めなければ `null` を返し、空文字に畳まない。** 空文字にすると
 * 「文字が無いテロップ」と「壊れたテロップ」が同じ見た目になり、
 * レンダラが黙って何も描かないのか、描くものが無いのかを区別できなくなる
 * （lessons L-015）。
 */
export const parseTextClipParams = (params: unknown): TextClipParams | null => {
  const parsed = TextClipParams.safeParse(params)
  return parsed.success ? parsed.data : null
}
