const BYTE_UNITS: readonly string[] = Object.freeze(['B', 'KB', 'MB', 'GB'])

/**
 * `33.1 MB`。1024 区切り。
 *
 * **ここが唯一の正。** 音源を選ぶ画面と Take の比較で別々に持つと、同じファイルが
 * 違う数字で出る（L-016 と同じ理由）。
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit] as string}`
}
