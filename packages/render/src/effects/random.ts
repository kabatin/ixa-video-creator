/**
 * エフェクトの乱れ（揺れ・グリッチ・線の位置）に使う**決まった乱数**（ADR-0050）。
 *
 * プレビュー（Player）と書き出し（renderMedia）は別のプロセスで同じコマを描くので、
 * `Math.random()` を使うと同じコマが毎回違う絵になる。種（クリップ・トランジションの ID）と
 * 番号だけで値が決まるようにする。
 */

/** 文字列を 32 ビットの種にする（FNV-1a）。 */
export const hashSeed = (seed: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** 種と番号から [0, 1) の値を 1 つ返す（mulberry32 の 1 段）。同じ引数なら必ず同じ値。 */
export const randomAt = (seed: number, index: number): number => {
  let t = (seed + Math.imul(index + 1, 0x6d2b79f5)) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** [-1, 1) の値。 */
export const signedRandomAt = (seed: number, index: number): number => randomAt(seed, index) * 2 - 1

/**
 * なめらかな乱れ（-1〜1）。整数の位置ごとの乱数を、間でなめらかに繋ぐ。
 * 揺れのように「毎コマ飛ぶ」と安っぽく見えるものに使う。
 */
export const smoothNoise = (seed: number, position: number): number => {
  const base = Math.floor(position)
  const t = position - base
  const eased = t * t * (3 - 2 * t)
  const a = signedRandomAt(seed, base)
  const b = signedRandomAt(seed, base + 1)
  return a + (b - a) * eased
}
