import { matchesTextQuery } from '@/lib/text-query'

/**
 * 素材ツリーの検索（UI-WORKBENCH 7.3）。**React を含まない。**
 * 揃え方（全角・半角、大文字・小文字、前後の空白）は作品一覧の検索と同じ `text-query.ts`。
 * 空の検索語はすべてに当たる。
 */
export const matchesAssetQuery = (label: string, query: string): boolean => matchesTextQuery(label, query)
