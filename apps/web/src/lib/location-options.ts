import type { Location } from '@ixa/domain'

/**
 * ロケーション選択の選択肢。
 * Shot は場所を 1 つだけ持つ（ADR-0015）ので、複数選択ではなく単一の select で表す。
 */

export type LocationOption = {
  readonly value: string
  readonly label: string
}

/**
 * 「なし」を表す select の値。
 * locationId は nullable で、外す操作を利用者が明示できる必要がある（ADR-0015）。
 */
export const NO_LOCATION_VALUE = ''

export const NO_LOCATION_LABEL = 'なし'

const NO_LOCATION_OPTION: LocationOption = {
  value: NO_LOCATION_VALUE,
  label: NO_LOCATION_LABEL,
}

/**
 * 参照画像の有無をラベルに出す。
 * 画像 0 枚のロケーションを選んでも生成の参照は増えないため、
 * 選ぶ前にそれと分からないと「選んだのに効かない」という誤解になる。
 */
const labelFor = (location: Location): string => {
  const count = location.referenceAssetIds.length
  const suffix = count === 0 ? '参照画像なし' : `参照画像 ${String(count)} 枚`
  return `${location.name}（${suffix}）`
}

/** 並び順は API が返した順のまま変えない。並べ替えの基準はドメインに無い。 */
export const toLocationOptions = (locations: readonly Location[]): readonly LocationOption[] => [
  NO_LOCATION_OPTION,
  ...locations.map((location) => ({ value: location.id, label: labelFor(location) })),
]

/**
 * 参照画像が生成へ渡ることを画面で説明する（docs/ARCHITECTURE.md §8 の参照枠）。
 * 場所を「メモ」だと思われると、参照画像を登録しないまま運用されてしまう。
 */
export const LOCATION_REFERENCE_NOTICE =
  '選んだロケーションの参照画像が、生成時の参照として自動で渡されます。'

/** 1 件も無いときに select を出しても選べる値が「なし」だけになり、壊れて見える。 */
export const LOCATION_EMPTY_NOTICE =
  'ロケーションが未登録です。登録すると、その参照画像を生成の参照に使えます。'
