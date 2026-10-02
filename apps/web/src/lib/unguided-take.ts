/**
 * 説明も最初のフレームも無い Shot で Take を作るときの確かめ（制作者 2026-10-01「全然関係ない動画が生成されてしまう」）。
 * 判定は domain の `lacksStoryboard`。ここは言葉だけ。1 件の生成と一括生成が同じ文を使う。
 */
export const UNGUIDED_TAKE_LABEL = 'このまま Take を作る'
export const BACK_TO_STORYBOARD_LABEL = '戻る'
export const UNGUIDED_TAKE_CONFIRM =
  'この Shot には説明も最初のフレーム（絵コンテの画像）もありません。このまま作ると、作品と関係ない映像になりやすいです。' +
  '先に絵コンテ（説明か最初のフレーム）を入れるのがおすすめです。'

/** 一括で頼むときの 1 行。0 件なら出さない（空文字）。 */
export const unguidedBulkLine = (count: number): string =>
  count === 0
    ? ''
    : `うち ${String(count)} 件は説明も最初のフレームも無く、作品と関係ない映像になりやすいです（先に絵コンテを入れるのがおすすめです）。`
