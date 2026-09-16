/**
 * 識別アンカー / スタイル / 配色 / 衣装トークンはすべて配列で持つ（docs/ARCHITECTURE.md §8）。
 * 1 本の文字列にまとめないのは、再生成ループで特定の要素だけを強調できるようにするため。
 * その編集ロジックを画面から切り離し、ブラウザ無しでテストできる純粋関数にする。
 */

export const MAX_TAG_LENGTH = 100

export type TagAddResult =
  | { readonly ok: true; readonly tags: readonly string[] }
  | { readonly ok: false; readonly reason: string }

const EMPTY_REASON = '空の値は追加できません。'
const DUPLICATE_REASON = 'すでに同じ値があります。'
const TOO_LONG_REASON = `${String(MAX_TAG_LENGTH)} 文字以内で入力してください。`

/**
 * タグを末尾へ追加する。元の配列は変更せず、常に新しい配列を返す。
 * 並び順はプロンプト断片の並びになるため保たれなければならない。
 */
export const addTag = (tags: readonly string[], raw: string): TagAddResult => {
  const value = raw.trim()
  if (value === '') return { ok: false, reason: EMPTY_REASON }
  if (value.length > MAX_TAG_LENGTH) return { ok: false, reason: TOO_LONG_REASON }
  if (tags.includes(value)) return { ok: false, reason: DUPLICATE_REASON }
  return { ok: true, tags: [...tags, value] }
}

/** 指定位置のタグを取り除く。範囲外なら元の並びをそのまま返す。 */
export const removeTagAt = (tags: readonly string[], index: number): readonly string[] =>
  index < 0 || index >= tags.length ? tags : tags.filter((_, position) => position !== index)
