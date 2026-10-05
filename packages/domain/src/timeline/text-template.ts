import { z } from 'zod'
import { NarrationLineId, TextStyleId } from '../common/ids.js'
import { TextStyle } from './text-style.js'

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
const TextClipText = z
  .string()
  .trim()
  .min(1, 'テロップの文字を入れてください')
  .max(MAX_TEXT_CLIP_LENGTH)

/**
 * テロップの最短の尺。これより短いと読めない。帯に置く・直すとき（画面）と、歌詞から置くとき（`lyrics`）が同じ値を読む。
 */
export const MIN_TEXT_CLIP_DURATION_SEC = 0.5

/** 話している字を強調する（ADR-0038）。 */
export const TextHighlight = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #RRGGBB の形で指定してください'),
  /** 字の時刻（テロップの頭からの秒）。テロップの字と 1 対 1。 */
  chars: z.array(z.object({ char: z.string(), startSec: z.number(), endSec: z.number() })).max(MAX_TEXT_CLIP_LENGTH),
})
export type TextHighlight = z.infer<typeof TextHighlight>

export const TextClipParams = z.object({
  /** 出す文字。空のテロップは置けない。 */
  text: TextClipText,
  /** 見た目の上書き（ADR-0028）。無い項目は型の既定値。 */
  style: TextStyle.optional(),
  /** どの保存済みスタイルから当てたか。スタイルを直したとき「使っているテロップ」を探すのに使う。 */
  styleId: TextStyleId.nullable().optional(),
  /**
   * 歌詞から置いたテロップの印（何行目か。ADR-0033）。置き直すとき差し替える相手を探すのに使う。
   * 手で置いたテロップには付けない（置き直しで消さない）。
   */
  lyricLine: z.number().int().nonnegative().optional(),
  /**
   * ナレーションから作ったテロップの印（どの行か。ADR-0038）。行が変わったら差し替える相手を探すのに使う。
   * 手で置いたテロップには付けない。
   */
  narrationLineId: NarrationLineId.optional(),
  /** 話している字を強調する（ADR-0038）。字の時刻（このテロップの頭からの秒）と色。 */
  highlight: TextHighlight.optional(),
})
export type TextClipParams = z.infer<typeof TextClipParams>

const NarrationLineMark = z.object({ narrationLineId: NarrationLineId })

/** ナレーションから作ったテロップなら、どの行か。手で置いたテロップ・読めない印は null。 */
export const narrationLineOf = (params: unknown): NarrationLineId | null => {
  const parsed = NarrationLineMark.safeParse(params)
  return parsed.success ? parsed.data.narrationLineId : null
}

const LyricLineMark = z.object({ lyricLine: z.number().int().nonnegative() })

/** 歌詞から置いたテロップなら何行目か。手で置いたテロップ・読めない印は null。 */
export const lyricLineOf = (params: unknown): number | null => {
  const parsed = LyricLineMark.safeParse(params)
  return parsed.success ? parsed.data.lyricLine : null
}

/** 文字だけ。見た目が読めないときの控え。 */
const TextOnly = z.object({ text: TextClipText })

/**
 * `params` からテロップの中身を取り出す。
 *
 * **読めなければ `null` を返し、空文字に畳まない。** 空文字にすると
 * 「文字が無いテロップ」と「壊れたテロップ」が同じ見た目になり、
 * レンダラが黙って何も描かないのか、描くものが無いのかを区別できなくなる
 * （lessons L-015）。
 */
export const parseTextClipParams = (params: unknown): TextClipParams | null => {
  const textOnly = TextOnly.safeParse(params)
  if (!textOnly.success) return null
  /**
   * **見た目・どのスタイルからか は項目ごとに読む。** どちらかが壊れていても、もう片方と文字は残す。
   * 読めない見た目は捨て、検査（`isTextStyleUnreadable`）で知らせる。
   */
  const raw = params as { readonly style?: unknown; readonly styleId?: unknown }
  const style = raw.style === undefined ? null : TextStyle.safeParse(raw.style)
  const styleId = raw.styleId === undefined ? null : TextStyleId.nullable().safeParse(raw.styleId)
  const lyricLine = lyricLineOf(params)
  const narrationLineId = narrationLineOf(params)
  const highlight = (params as { readonly highlight?: unknown }).highlight
  const parsedHighlight = highlight === undefined ? null : TextHighlight.safeParse(highlight)
  return {
    text: textOnly.data.text,
    ...(style?.success === true ? { style: style.data } : {}),
    ...(styleId?.success === true ? { styleId: styleId.data } : {}),
    ...(lyricLine === null ? {} : { lyricLine }),
    ...(narrationLineId === null ? {} : { narrationLineId }),
    // 読めない強調は捨てる（文字は普通に出す）。
    ...(parsedHighlight?.success === true ? { highlight: parsedHighlight.data } : {}),
  }
}
