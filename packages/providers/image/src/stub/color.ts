/**
 * 生成画像の色をプロンプトから決定的に決める。
 * 同じプロンプトなら必ず同じ色になり、違うプロンプトなら別の色になる。
 *
 * 目的は「どのプロンプトから出た絵か」を目で区別できるようにすること（ADR-0014 と同じ意図）。
 * 動画スタブにも同種の関数があるが、Provider パッケージ間の依存を作らないため
 * ここに独立して持つ（共有するなら provider-core へ引き上げるべき。Architect 判断）。
 */

/** FNV-1a 32bit。暗号用途ではなく、色の決定にだけ使う。 */
export const fnv1a32 = (value: string): number => {
  const OFFSET_BASIS = 0x811c9dc5
  const PRIME = 0x01000193
  let hash = OFFSET_BASIS
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), PRIME)
  }
  return hash >>> 0
}

const hueToChannel = (p: number, q: number, tRaw: number): number => {
  const t = tRaw < 0 ? tRaw + 1 : tRaw > 1 ? tRaw - 1 : tRaw
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

const toHexByte = (channel: number): string =>
  Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()

/** HSL から `#RRGGBB` へ。h は 0..1、s / l は 0..1。 */
export const hslToHex = (h: number, s: number, l: number): string => {
  if (s === 0) {
    const gray = toHexByte(l)
    return `#${gray}${gray}${gray}`
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = hueToChannel(p, q, h + 1 / 3)
  const g = hueToChannel(p, q, h)
  const b = hueToChannel(p, q, h - 1 / 3)
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
}

/** `#RRGGBB` を drawbox / drawtext が受け付ける `0xRRGGBB` 形式にする。 */
export const toFfmpegColor = (hex: string): string => `0x${hex.slice(1)}`

const BACKGROUND_SATURATION = 0.5
const BACKGROUND_LIGHTNESS_MIN = 0.16
const BACKGROUND_LIGHTNESS_RANGE = 0.1

/** 白い枠線とラベルが確実に読める暗さに固定する。 */
export const colorForPrompt = (prompt: string): string => {
  const hash = fnv1a32(prompt)
  const hue = (hash % 360) / 360
  const lightness =
    BACKGROUND_LIGHTNESS_MIN + (((hash >>> 9) % 100) / 100) * BACKGROUND_LIGHTNESS_RANGE
  return hslToHex(hue, BACKGROUND_SATURATION, lightness)
}

const QUADRANT_HUE_STEP = 0.045
const QUADRANT_SATURATION = 0.45
const QUADRANT_LIGHTNESS_BASE = 0.24
const QUADRANT_LIGHTNESS_STEP = 0.07

/**
 * 象限ごとの色調。**同じプロンプトから 4 つの異なる色調**を作る。
 * 色相をわずかにずらし明度を段階的に上げることで、
 * 「1 枚の絵が 4 面に分かれている」ことが一目で分かるようにする。
 */
export const quadrantColorsForPrompt = (prompt: string, count = 4): readonly string[] => {
  const hash = fnv1a32(prompt)
  const baseHue = (hash % 360) / 360
  return Array.from({ length: count }, (_, index) =>
    hslToHex(
      (baseHue + index * QUADRANT_HUE_STEP) % 1,
      QUADRANT_SATURATION,
      QUADRANT_LIGHTNESS_BASE + index * QUADRANT_LIGHTNESS_STEP,
    ),
  )
}

/** 象限内に置くシルエットの色。背景より明るくして人物ブロックとして見えるようにする。 */
export const figureColorForPrompt = (prompt: string): string => {
  const hash = fnv1a32(prompt)
  return hslToHex(((hash % 360) / 360 + 0.5) % 1, 0.35, 0.72)
}
