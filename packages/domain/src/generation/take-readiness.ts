/**
 * 説明も最初のフレーム（絵コンテの画像）も無い Shot か（制作者 2026-10-01「全然関係ない動画が生成されてしまう」）。
 *
 * このまま Take を作ると、生成の手掛かりが作品の方針しか無く、作品と関係ない映像になりやすい。
 * 止めはしない（確かめてから作れる）。**1 件の生成と一括生成が同じ判定を使う。**
 */
export const lacksStoryboard = (shot: {
  readonly description: string
  readonly hasStartFrame: boolean
}): boolean => shot.description.trim() === '' && !shot.hasStartFrame
