/**
 * アップロード完了通知に載せる sha256。
 * API 側は実体の checksum で重複排除するため、ここで必ず実データから計算する。
 */

const toHex = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')

export const sha256Hex = async (data: ArrayBuffer): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', data))
