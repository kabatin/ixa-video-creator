import { TextStyle, TextStyleKey, lyricLineOf, type TimelineClipId } from '@ixa/domain'
import type { WireTimelineClip } from '@/lib/timeline-api'

/**
 * テロップの見た目を変える範囲（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * **React を含まない純粋な関数。**
 *
 * - このテロップだけ
 * - 歌詞のテロップすべて（歌詞から置いた印 `params.lyricLine` のあるもの。無ければ出さない）
 * - テロップすべて
 */
export type TextClipScopeId = 'this' | 'lyrics' | 'all'

export type TextClipScope = {
  readonly id: TextClipScopeId
  readonly label: string
  readonly clipIds: readonly TimelineClipId[]
}

const textParamsOf = (clip: WireTimelineClip): Record<string, unknown> | null =>
  clip.content.type === 'text' ? clip.content.params : null

export const textClipScopes = (
  clips: readonly WireTimelineClip[],
  currentId: TimelineClipId,
): readonly TextClipScope[] => {
  const texts = clips.filter((clip) => textParamsOf(clip) !== null)
  const lyrics = texts.filter((clip) => lyricLineOf(textParamsOf(clip)) !== null)
  return [
    { id: 'this', label: 'このテロップだけ', clipIds: [currentId] },
    ...(lyrics.length === 0
      ? []
      : [{ id: 'lyrics' as const, label: `歌詞のテロップすべて（${String(lyrics.length)}）`, clipIds: lyrics.map((clip) => clip.id) }]),
    { id: 'all', label: `テロップすべて（${String(texts.length)}）`, clipIds: texts.map((clip) => clip.id) },
  ]
}

/**
 * 選んでいた範囲を、いまのテロップに当てはめる。**いまのテロップが入らない範囲は「このテロップだけ」に戻す**
 * （歌詞でないテロップを開いたのに「歌詞のテロップすべて」のままだと、開いたテロップは変わらず別のものが変わる）。
 */
export const resolveTextClipScope = (
  scopes: readonly TextClipScope[],
  wanted: TextClipScopeId,
  currentId: TimelineClipId,
): TextClipScope => {
  const found = scopes.find((scope) => scope.id === wanted)
  const fallback = scopes[0] as TextClipScope
  return found !== undefined && found.clipIds.includes(currentId) ? found : fallback
}

/**
 * 欄が渡す「変えた項目」を、まとめて変える口の形（上書き・外す）にする。
 * `undefined` の項目は外す（型の既定に戻す）。上書きは `TextStyle` で確かめる（範囲の外は投げる）。
 */
export const toStyleChange = (
  patch: Partial<Record<TextStyleKey, unknown>>,
): { readonly set: TextStyle; readonly unset: readonly TextStyleKey[] } => {
  const entries = Object.entries(patch) as [TextStyleKey, unknown][]
  return {
    set: TextStyle.parse(Object.fromEntries(entries.filter(([, value]) => value !== undefined))),
    unset: entries.filter(([, value]) => value === undefined).map(([key]) => key),
  }
}

/** 「型の既定に戻す」をまとめて当てるとき。見た目の項目を全部外す。 */
export const RESET_ALL_STYLE: { readonly set: TextStyle; readonly unset: readonly TextStyleKey[] } = {
  set: {},
  unset: TextStyleKey.options,
}
