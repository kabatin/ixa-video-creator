/**
 * 素材ツリーの検索（UI-WORKBENCH 7.3）。**React を含まない。**
 * 大文字・小文字と全角・半角の違いで見つからない、を起こさない（NFKC で揃える）。
 * 空の検索語はすべてに当たる。
 */
const normalize = (text: string): string => text.normalize('NFKC').toLowerCase().trim()

export const matchesAssetQuery = (label: string, query: string): boolean => {
  const needle = normalize(query)
  return needle === '' || normalize(label).includes(needle)
}
