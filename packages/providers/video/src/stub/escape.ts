/**
 * drawtext に渡す文字列のエスケープ。
 *
 * FFmpeg のフィルタ文字列は 3 段階でパースされ、各段が 1 枚ずつバックスラッシュを剥がす
 * （ffmpeg-utils "Quoting and escaping"）。1 段でも取りこぼすと
 * 「No option name near ...」のような原因の分からないエラーになるため、
 * **純粋関数として切り出してテストする**。
 *
 *   1. filtergraph レベル  … `,` `;` `[` `]` `'` `\` が特別
 *   2. filter 引数レベル   … `:` `=` `'` `\` が特別
 *   3. drawtext 展開レベル … `%{...}` が展開される。`%` `\` が特別
 *
 * エスケープは内側（3）から外側（1）の順に適用する。
 */

const SPECIALS_EXPANSION = /[\\%]/g
const SPECIALS_FILTER_ARGS = /[\\':=]/g
const SPECIALS_FILTER_GRAPH = /[\\',;[\]]/g

const backslashEscape = (value: string, specials: RegExp): string =>
  value.replace(specials, (char) => `\\${char}`)

/** drawtext の展開レベル。`%` を literal にし、バックスラッシュを保護する。 */
export const escapeForTextExpansion = (value: string): string =>
  backslashEscape(value, SPECIALS_EXPANSION)

/** filter 引数レベル（`:` でオプションが区切られる層）。 */
export const escapeForFilterArgs = (value: string): string =>
  backslashEscape(value, SPECIALS_FILTER_ARGS)

/** filtergraph レベル（`,` `;` でフィルタが区切られる層）。 */
export const escapeForFilterGraph = (value: string): string =>
  backslashEscape(value, SPECIALS_FILTER_GRAPH)

/**
 * ユーザー由来のテキストを drawtext の `text=` 値へ落とす。
 * `%{pts}` のような展開は一切行われず、そのまま文字として描画される。
 */
export const escapeDrawtextText = (value: string): string =>
  escapeForFilterGraph(escapeForFilterArgs(escapeForTextExpansion(value)))

/**
 * `%{pts\:hms}` のような **展開式を含む** テキストを `text=` 値へ落とす。
 * 展開レベルのエスケープを行わないため、`%{...}` が生きたまま FFmpeg に届く。
 * 呼び出し側が組み立てた式にのみ使うこと（外部入力に使わない）。
 */
export const escapeDrawtextExpression = (value: string): string =>
  escapeForFilterGraph(escapeForFilterArgs(value))
