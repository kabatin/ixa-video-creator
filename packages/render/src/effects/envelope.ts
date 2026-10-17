/**
 * エフェクトの強さの時間変化（0〜1）。どれもコマと値だけで決まる純粋な関数（ADR-0050）。
 */

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 終わりに向かってゆっくり止まる。 */
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3

/** 頭はゆっくり、終わりで速く。 */
export const easeInQuad = (t: number): number => clamp01(t) ** 2

/**
 * 立ち上がって消える（フラッシュ）。`attackSec` で 0→1、そこから `decaySec` で 1→0。
 * 立ち上がりが 0 なら頭のコマでいきなり最大。
 */
export const attackDecay = (sec: number, attackSec: number, decaySec: number): number => {
  if (sec < 0) return 0
  if (sec < attackSec) return clamp01(sec / attackSec)
  return 1 - easeOutCubic((sec - attackSec) / decaySec)
}

/**
 * 頭と尻をなめらかに出し入れする（光漏れ・スピード線など、尺の間ずっと出ているもの）。
 * `fadeRatio` は尺に対する出し入れの割合（片側）。
 */
export const fadeInOut = (sec: number, durationSec: number, fadeRatio: number): number => {
  if (durationSec <= 0 || sec < 0 || sec > durationSec) return 0
  const fade = Math.max(1e-6, durationSec * fadeRatio)
  return clamp01(Math.min(sec / fade, (durationSec - sec) / fade))
}

/** コマと尺（秒）。描く部品に渡す時刻の組。 */
export type EffectTime = {
  /** クリップの頭からの秒。 */
  readonly sec: number
  readonly durationSec: number
  /** クリップの頭からのコマ。毎コマ変える乱れ（グリッチ）の番号に使う。 */
  readonly frame: number
  readonly fps: number
}

export const effectTimeAt = (frame: number, durationInFrames: number, fps: number): EffectTime => ({
  sec: frame / fps,
  durationSec: durationInFrames / fps,
  frame,
  fps,
})
