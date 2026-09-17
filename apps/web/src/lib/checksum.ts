/**
 * アップロード完了通知に載せる sha256。
 * API 側は実体の checksum で重複排除するため、ここで必ず実データから計算する。
 *
 * **`crypto.subtle` は安全なコンテキストでしか使えない。**
 * HTTPS か localhost でのみ有効で、`http://192.168.0.x` のような LAN の
 * アドレスで開くと `undefined` になる。実際に LAN の別 PC から音源を上げたとき
 * `Cannot read properties of undefined (reading 'digest')` で落ちた。
 * ブラウザが使えないときのために、同じ計算を自前でも持つ。
 */

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** SHA-256 の丸め定数（最初の 64 個の素数の立方根の小数部）。 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits))

/**
 * SHA-256 を自前で計算する。`crypto.subtle` が使えない環境のための代替。
 *
 * **仕様どおりの実装であることを、既知のテストベクタで確かめている。**
 * 暗号処理を自前で書くのは避けたいが、ここでの用途は重複排除の鍵であり
 * 秘密を守るためではない。外部の依存を増やすより、検証可能な 60 行を持つほうを選ぶ。
 */
const sha256Fallback = (data: ArrayBuffer): Uint8Array => {
  const input = new Uint8Array(data)
  const bitLength = input.length * 8

  // 末尾に 0x80 を置き、長さ（64bit）が入るまで 0 で埋める。
  const paddedLength = (((input.length + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(paddedLength)
  padded.set(input)
  padded[input.length] = 0x80

  const view = new DataView(padded.buffer)
  // 長さは 64bit だが、扱う素材は 2^53 ビットに届かないので上位は 0 のままでよい。
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number
      const b = w[i - 2] as number
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [
      number, number, number, number, number, number, number, number,
    ]

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0

      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    const next = [a, b, c, d, e, f, g, hh]
    for (let i = 0; i < 8; i += 1) h[i] = ((h[i] as number) + (next[i] as number)) >>> 0
  }

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, h[i] as number, false)
  return out
}

/** ブラウザの実装が使えるか。安全なコンテキスト以外では `subtle` が生えない。 */
export const hasNativeDigest = (): boolean =>
  typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function'

export const sha256Hex = async (data: ArrayBuffer): Promise<string> => {
  if (hasNativeDigest()) {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
  }
  return toHex(sha256Fallback(data))
}
