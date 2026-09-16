import { z } from 'zod'

/**
 * ブランド色の要求（ADR-0005 の brand レビュア）。
 *
 * `@ixa/review` の `BrandColorRequirement` は「key がどれだけ画面を占めるか」しか持たない。
 * その key が**どの色なのか**は測定側が知っている必要があるため、worker 側で hex を足した形を持つ。
 * 判定（`DeterministicReviewer`）は key と比率しか見ないので、色の定義がレビュア実装へ漏れない。
 */

/** `#RGB` は許さない。BrandAsset.value が `#FFD200` 形式で入る想定に合わせる。 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const BrandColorTarget = z
  .object({
    /** `FrameSample.colorRatios` のキーになる。判定側の要求と一致させること。 */
    key: z.string().min(1),
    hex: z.string().regex(HEX_COLOR, 'ブランド色は #RRGGBB 形式で指定すること'),
    minRatio: z.number().min(0).max(1),
    maxRatio: z.number().min(0).max(1),
    /**
     * 一致とみなす色距離（0..1 に正規化した RGB ユークリッド距離）。
     * 動画は圧縮とグレーディングで色が必ず動くため、完全一致では一度も当たらない。
     */
    tolerance: z.number().min(0).max(1).optional(),
  })
  .refine((t) => t.minRatio <= t.maxRatio, {
    message: 'minRatio は maxRatio 以下であること',
  })
export type BrandColorTarget = z.infer<typeof BrandColorTarget>

/**
 * 既定の許容距離。0..1 に正規化した RGB 空間での距離で、最大値は sqrt(3) ≒ 1.732。
 * 0.2 は「同系色だが明度・彩度が多少ずれたもの」までを拾い、
 * 補色や無彩色は拾わない幅として選んだ。運用しながら target ごとに上書きできる。
 */
export const DEFAULT_COLOR_TOLERANCE = 0.2

export type Rgb = {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** `#RRGGBB` を 0..255 の RGB へ。形式は BrandColorTarget で検証済みだが、単体でも防御する。 */
export const parseHexColor = (hex: string): Rgb => {
  if (!HEX_COLOR.test(hex)) {
    throw new Error(`ブランド色を解釈できません: ${hex}（#RRGGBB 形式で指定すること）`)
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

/** 測定側が使う、解決済みのブランド色。hex を毎ピクセル解釈し直さないために先に畳んでおく。 */
export type ResolvedBrandColor = {
  readonly key: string
  readonly rgb: Rgb
  /** 距離の 2 乗で比較するため、しきい値も 2 乗して持つ（ピクセルごとの sqrt を避ける）。 */
  readonly toleranceSquared: number
}

export const resolveBrandColor = (target: BrandColorTarget): ResolvedBrandColor => {
  const tolerance = target.tolerance ?? DEFAULT_COLOR_TOLERANCE
  return {
    key: target.key,
    rgb: parseHexColor(target.hex),
    toleranceSquared: tolerance * tolerance,
  }
}
