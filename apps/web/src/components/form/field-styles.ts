/**
 * 入力欄の見た目を 1 箇所に置く。
 *
 * **部品同士で import し合わない。** 以前は text-field.tsx が定義して
 * select-field と textarea-field と tag-input が読んでいた。兄弟の 1 つが
 * 他の土台になっていると、その 1 つを消したり分けたりできなくなる。
 */

/**
 * 入力欄の枠・余白・フォーカスを 1 箇所に集める。
 *
 * **`focus:outline-none` を書かないこと。** 以前は入力プリミティブ 4 つすべてに
 * 付いていて、フォーカス時に変わるのは枠線がわずかに濃くなるだけだった。
 * キーボードだけの利用者が、いまどこにいるか分からなかった。
 *
 * 見え方は `components/ui/button` の主ボタンと揃える。同じ「いまここ」の合図に
 * 違う見た目を使わない。
 */
export const FIELD_CONTROL_CLASS =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm shadow-sm ' +
  'focus-visible:border-line-strong focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-focus ' +
  'disabled:bg-surface-2 disabled:text-muted'

/** 項目名。12px まで落とさない。小さい文字ほどコントラストが効かなくなる。 */
export const FIELD_LABEL_CLASS = 'block text-sm font-medium text-text'

/** 補足説明。12px なので `faint` は使わない。`muted` は地の上で 7.6:1 ある。 */
export const FIELD_HINT_CLASS = 'text-xs text-muted'
