import { runFfmpeg } from './ffmpeg-runner.js'

/**
 * FFmpeg の `drawtext` フィルタが使えるかを判定する。
 *
 * Homebrew の `ffmpeg` は libfreetype 無しでビルドされており drawtext が入っていない
 * （2026-09-16 に実測）。特定のビルドに依存すると CI と別の開発機で動かなくなるため、
 * **実行時に判定して無ければ縮退する**。
 *
 * 判定と縮退の実装を 1 箇所に集約しているのは、
 * 複数の Provider が別々に持つと**片方だけ直したときに挙動がずれる**ため。
 */
export const hasFilter = (filtersOutput: string, filterName: string): boolean => {
  // 各行の 2 列目がフィルタ名。説明文に名前が出てきても誤検知しない。
  const escaped = filterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*\\S+\\s+${escaped}\\s`, 'm').test(filtersOutput)
}

export const hasDrawtext = (filtersOutput: string): boolean =>
  hasFilter(filtersOutput, 'drawtext')

/** 旧名。 */
export const parseHasDrawtext = hasDrawtext

/** 強制的に縮退させる。drawtext がある環境でも縮退経路を試せるようにする。 */
export const FORCE_NO_DRAWTEXT_ENV = 'STUB_FORCE_NO_DRAWTEXT'

/**
 * 環境オブジェクトでも、値そのものでも受け付ける。
 * 値だけを渡せると、環境変数を組み立てずに真偽の判定規則だけをテストできる。
 */
export const isForcedNoDrawtext = (
  source: NodeJS.ProcessEnv | string | undefined = process.env,
): boolean => {
  const value = typeof source === 'string' || source === undefined
    ? source
    : source[FORCE_NO_DRAWTEXT_ENV]
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

let cached: Promise<boolean> | undefined

/**
 * 実 ffmpeg に問い合わせて判定する。1 プロセスにつき 1 回だけ実行しキャッシュする。
 * 強制縮退のときはキャッシュを使わないので、同一プロセスで両経路を試せる。
 */
export const detectDrawtextSupport = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> => {
  if (isForcedNoDrawtext(env)) return false
  cached ??= runFfmpeg(['-hide_banner', '-filters'], { timeoutMs: 30_000 })
    .then((result) => hasDrawtext(result.stdout))
    // 判定に失敗したら「無い」とみなす。縮退した絵は出るが生成自体は止めない。
    // 本当の失敗は実際の描画時に FfmpegError として stderr つきで出る。
    .catch(() => false)
  return cached
}

/** テスト用。 */
export const resetDrawtextSupportCache = (): void => {
  cached = undefined
}

/**
 * drawtext に渡す文字列のエスケープ。
 *
 * FFmpeg のフィルタ文字列は 3 段階でパースされ、各段が 1 枚ずつバックスラッシュを剥がす
 * （ffmpeg-utils "Quoting and escaping"）。1 段でも取りこぼすと
 * 「No option name near ...」のような原因の分からないエラーになる。
 *
 *   1. filtergraph レベル  … `,` `;` `[` `]` `'` `\` が特別
 *   2. filter 引数レベル   … `:` `=` `'` `\` が特別
 *   3. drawtext 展開レベル … `%{...}` が展開される。`%` `\` が特別
 *
 * エスケープは内側（3）から外側（1）の順に適用する。
 * **この規則は実 ffmpeg のエラーメッセージで剥がれ方を実測して合わせたもの。**
 * 推測で簡略化しないこと。
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

/** 旧名（画像 Provider 側で使っていたもの）。 */
export const escapeDrawtextExpansion = escapeForTextExpansion
export const escapeFilterArgument = escapeForFilterArgs
export const escapeFiltergraph = escapeForFilterGraph

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
