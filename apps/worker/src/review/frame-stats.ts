import type { ResolvedBrandColor } from './brand-color.js'

/**
 * 1 フレームの見た目を要約する純粋関数（ADR-0005 Stage 1 の測定側）。
 *
 * ffmpeg には **rawvideo / rgb24** で吐かせる。JPEG を経由しないのは、
 * デコーダを 1 つ増やさずに済み、かつ非可逆圧縮のノイズが色の占有率に乗らないため。
 * 1 ピクセル = 3 バイト（R, G, B の順）で、行方向に隙間なく並ぶ。
 */

/** Rec.709 の輝度係数。動画は BT.709 が既定なので、BT.601 の係数は使わない。 */
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

const MAX_CHANNEL_VALUE = 255
const BYTES_PER_PIXEL = 3

export type FrameStats = {
  /** 0..1。全黒フレームの検出に使う。 */
  readonly meanLuma: number
  /** 色名 → 画面占有率（0..1）。 */
  readonly colorRatios: Readonly<Record<string, number>>
}

/**
 * rgb24 のフレームバッファから `meanLuma` と `colorRatios` を出す。
 *
 * **colorRatios の算出方法**
 * 1. ブランド色ごとに、目標 RGB との距離を各ピクセルについて測る。
 *    距離は各チャンネルを 0..1 に正規化した RGB 空間のユークリッド距離で、
 *    毎ピクセルの平方根を避けるため 2 乗のまま `toleranceSquared` と比較する。
 * 2. 距離が許容内なら「その色のピクセル」として数える。
 *    **1 ピクセルが複数の色に当たることを許す**（近い 2 色を登録したときに
 *    どちらか一方だけが勝つと、比率が登録順に依存してしまうため）。
 * 3. 一致数をフレームの総ピクセル数で割った値を占有率とする。
 *
 * 知覚的な色差（CIEDE2000 など）ではなく RGB 距離で足りると判断した理由は、
 * ADR-0005 が brand レビュアに求めるのが「ブランド色が画面に一定割合あるか」という
 * 粗い判定であり、色差の精度より**毎回同じ値が出ること**が重要だからである。
 */
export const analyzeRgbFrame = (
  pixels: Uint8Array,
  colors: readonly ResolvedBrandColor[],
): FrameStats => {
  if (pixels.length === 0 || pixels.length % BYTES_PER_PIXEL !== 0) {
    throw new Error(
      `rgb24 フレームの長さが不正です: ${pixels.length} バイト（3 の倍数かつ 1 以上であること）`,
    )
  }

  const pixelCount = pixels.length / BYTES_PER_PIXEL

  /**
   * ローカルの集計バッファ。ピクセルごとに新しい配列を作ると 4K 1 枚で数百万回の確保になる。
   * この関数の外へ出る値は常に新しいオブジェクトとして組み立てる。
   */
  const matchCounts = new Float64Array(colors.length)
  let lumaSum = 0

  for (let offset = 0; offset < pixels.length; offset += BYTES_PER_PIXEL) {
    const r = pixels[offset] ?? 0
    const g = pixels[offset + 1] ?? 0
    const b = pixels[offset + 2] ?? 0

    lumaSum += LUMA_R * r + LUMA_G * g + LUMA_B * b

    for (let index = 0; index < colors.length; index += 1) {
      const color = colors[index]
      if (color === undefined) continue
      const dr = (r - color.rgb.r) / MAX_CHANNEL_VALUE
      const dg = (g - color.rgb.g) / MAX_CHANNEL_VALUE
      const db = (b - color.rgb.b) / MAX_CHANNEL_VALUE
      if (dr * dr + dg * dg + db * db <= color.toleranceSquared) {
        matchCounts[index] = (matchCounts[index] ?? 0) + 1
      }
    }
  }

  const colorRatios = Object.fromEntries(
    colors.map((color, index) => [color.key, (matchCounts[index] ?? 0) / pixelCount]),
  )

  return {
    meanLuma: lumaSum / (pixelCount * MAX_CHANNEL_VALUE),
    colorRatios,
  }
}
