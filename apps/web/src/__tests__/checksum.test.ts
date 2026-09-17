import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasNativeDigest, sha256Hex } from '@/lib/checksum'

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer

/** NIST の既知のテストベクタ。自前の実装が仕様どおりかを、これで担保する。 */
const VECTORS: readonly { readonly input: string; readonly expected: string }[] = [
  { input: '', expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { input: 'abc', expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  {
    input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    expected: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sha256Hex', () => {
  it.each(VECTORS)('既知のベクタと一致する: "$input"', async ({ input, expected }) => {
    expect(await sha256Hex(bytesOf(input))).toBe(expected)
  })

  it('crypto.subtle が無くても同じ答えを出す', async () => {
    const native = await sha256Hex(bytesOf('iXA CUP MUSIC VIDEO'))

    // 安全でないコンテキスト（LAN の http など）では subtle が生えない。
    vi.stubGlobal('crypto', {})
    expect(hasNativeDigest()).toBe(false)

    expect(await sha256Hex(bytesOf('iXA CUP MUSIC VIDEO'))).toBe(native)
  })

  it.each(VECTORS)('代替の実装も既知のベクタと一致する: "$input"', async ({ input, expected }) => {
    vi.stubGlobal('crypto', {})

    expect(await sha256Hex(bytesOf(input))).toBe(expected)
  })

  it('ブロック境界をまたぐ長さでも一致する（詰め物の計算を確かめる）', async () => {
    // 55 / 56 / 64 / 119 / 120 バイトは詰め物の分岐が変わる長さ。
    for (const length of [55, 56, 64, 119, 120, 1000]) {
      const data = bytesOf('a'.repeat(length))

      const native = await sha256Hex(data)
      vi.stubGlobal('crypto', {})
      const fallback = await sha256Hex(data)
      vi.unstubAllGlobals()

      expect(fallback).toBe(native)
    }
  })

  it('大きな入力でも一致する（音源は数十 MB になる）', async () => {
    const data = new Uint8Array(3_000_000).map((_, i) => i % 251).buffer

    const native = await sha256Hex(data)
    vi.stubGlobal('crypto', {})

    expect(await sha256Hex(data)).toBe(native)
  })
})
