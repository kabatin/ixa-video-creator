/**
 * 手順を飛ばしたときの確認の文（制作者 2026-10-03「手順を飛び越えて作業をしようとしている場合には警告ダイアログを出して、
 * 任意の上で実行するようにしたほうが安全かもしれない」）。**React を含まない純粋な関数。**
 *
 * 止めはしない。理由を言って、選べば続けられるようにする（確認のボタンは危険色にしない）。
 */

export const DRAW_ANYWAY_LABEL = 'このまま作る'

type Described = { readonly code: string; readonly description: string }

/**
 * 絵コンテ（説明）が空のまま絵を作ろうとしている。空が無ければ null。
 * 絵コンテが空かは**説明だけ**で見る（`lacksStoryboard` は最初のフレームがあると false になる。作り直しで効かない）。
 */
export const drawWithoutStoryboardWarning = (shots: readonly Described[]): string | null => {
  const empty = shots.filter((shot) => shot.description.trim() === '')
  const [only] = empty
  if (only === undefined) return null
  const why =
    '説明が無いと、作品の方針と登場人物だけで描くので、思った絵にならないことが多く、AI の利用枠も使います。'
  return shots.length === 1
    ? `${only.code} は絵コンテ（説明）がまだ空です。${why}先に絵コンテを書くなら「やめる」を押してください。`
    : `チェックした ${String(shots.length)} 件のうち ${String(empty.length)} 件は絵コンテ（説明）がまだ空です。${why}`
}
