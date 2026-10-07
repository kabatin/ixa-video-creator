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

/**
 * カメラの動きが決まっていない Shot か（ADR-0042）。
 *
 * **実測（2026-10-07・同じ開始画像と同じシード）**: 椅子から立ち上がる Shot を、カメラの指定なしで
 * 作ると**立ち上がった瞬間に顔が画面の外へ出た**。同じ仕様にカメラの 1 文（ティルト・中）を足すと、
 * 顔と全身が最後まで収まった。差はその 1 文だけ。
 *
 * **`static`（フィックス）は数えない。** 動かない Shot ではそれが正しい指定で、
 * 「動く Shot かどうか」は説明の文章を読まないと分からない。語で当てにいくと、
 * 言い回しを外したときに黙って通る（止めるより、決めていないことだけを言う）。
 *
 * 止めはしない。意図して未指定にすることもある。
 */
export const lacksCameraMovement = (shot: {
  readonly camera: { readonly movement: string | null }
}): boolean => shot.camera.movement === null
