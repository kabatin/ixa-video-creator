/**
 * Shot ごとに背景色を変え、タイムライン上で Shot の切り替わりが目で分かるようにする（ADR-0014）。
 * 同じ shotId は必ず同じ色になる（決定的）。
 */

/** FNV-1a 32bit。暗号用途ではなく、色の決定にだけ使う。 */
const fnv1a32 = (value: string): number => {
  const OFFSET_BASIS = 0x811c9dc5
  const PRIME = 0x01000193
  let hash = OFFSET_BASIS
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), PRIME)
  }
  return hash >>> 0
}

/** 白文字が確実に読める暗さに固定する。彩度も落としすぎない。 */
const SATURATION = 0.55
const LIGHTNESS_MIN = 0.2
const LIGHTNESS_RANGE = 0.12

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

/**
 * shotId から決定的に背景色を決める。
 * 色相だけを散らし、彩度と明度は一定範囲に保つ。
 */
export const colorForShot = (shotId: string): string => {
  const hash = fnv1a32(shotId)
  const hue = (hash % 360) / 360
  // 明度も少しだけ揺らす。色相が近い Shot 同士でも見分けが付くようにするため。
  const lightness = LIGHTNESS_MIN + ((hash >>> 9) % 100) / 100 * LIGHTNESS_RANGE
  return hslToHex(hue, SATURATION, lightness)
}
