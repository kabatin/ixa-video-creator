/**
 * 波形の高さを、パネルの余りから決める（純粋関数）。
 *
 * 波形は定数 78px の固定で、**パネルを縦に広げても大きくならなかった**。
 * 増えるのは下のフォームの余白だけで、聴きながら山を見て区切りを置くという
 * いちばん精度が要る作業に、いちばんピクセルが無い状態だった（実測: 本文 396px 中 78px）。
 *
 * 以前 `flex-1` で埋めようとして戻したのは、下の操作列が画面外へ押し出されたため。
 * ここでは**他の中身の高さをそのまま残し、余ったぶんだけ**を波形に渡す。
 */

/** これ以上小さいと山が読めない。 */
export const MIN_WAVEFORM_HEIGHT_PX = 96

/** これ以上大きくしても読みやすさは増えず、下の操作が遠くなる。 */
export const MAX_WAVEFORM_HEIGHT_PX = 420

export type WaveformFillInput = {
  /** パネル本文の見えている高さ。**内側の余白は引いたもの**を渡すこと。 */
  readonly bodyClientHeight: number
  /**
   * 中身の実際の高さ。**`scrollHeight` ではない。**
   *
   * 余裕があるときの `scrollHeight` は入れ物の高さと同じ値を返すので、
   * 「あとどれだけ空いているか」が測れない（広げても波形が 94px のままだった）。
   * 入れ物ではなく**中身そのもの**の高さを渡すこと。
   */
  readonly contentHeight: number
  /** いまの波形の高さ（状態）。測れないときはこれを保つ。 */
  readonly currentHeight: number
  /**
   * 画面に出ている波形の箱の高さ。**状態と画面が食い違っている間は、こちらで「波形以外」を求める。**
   * 状態の値で引くと、まだ画面に出ていない高さを引いてしまい、上限と下限を往復した（WebKit で実測）。
   * 省略時は `currentHeight`。
   */
  readonly renderedHeight?: number
}

/**
 * 余りの高さ。**中身のうち波形以外の高さは変えない。**
 *
 * `contentHeight - currentHeight` が「波形以外」の高さ。
 * 見えている高さからそれを引いたぶんが波形に使える。
 * 引いた結果が下限を切るときは下限に留め、はみ出しは従来どおりスクロールで見せる。
 */
export const fillWaveformHeight = ({
  bodyClientHeight,
  contentHeight,
  currentHeight,
  renderedHeight = currentHeight,
}: WaveformFillInput): number => {
  if (bodyClientHeight <= 0 || contentHeight <= 0) return currentHeight
  const others = contentHeight - renderedHeight
  const available = bodyClientHeight - others
  return Math.round(
    Math.min(MAX_WAVEFORM_HEIGHT_PX, Math.max(MIN_WAVEFORM_HEIGHT_PX, available)),
  )
}

/** 1〜2px の揺れで描き直さない。無限に測り直すのを止める。 */
export const WAVEFORM_HEIGHT_EPSILON_PX = 4

export const shouldResizeWaveform = (current: number, next: number): boolean =>
  Math.abs(current - next) > WAVEFORM_HEIGHT_EPSILON_PX
