/**
 * 名前で探すときの揃え方（素材ツリー・作品一覧）。**React を含まない。**
 * 大文字・小文字と全角・半角の違いで見つからない、を起こさない（NFKC で揃える）。前後の空白は落とす。
 */
export const normalizeQueryText = (text: string): string => text.normalize('NFKC').toLowerCase().trim()

/** 名前が検索語を含むか。空の検索語（空白だけも）はすべてに当たる。 */
export const matchesTextQuery = (label: string, query: string): boolean => {
  const needle = normalizeQueryText(query)
  return needle === '' || normalizeQueryText(label).includes(needle)
}
