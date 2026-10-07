import { describe, expect, it } from 'vitest'
import {
  MIN_SIGNING_SECRET_LENGTH,
  signStorageAccess,
  verifyStorageAccess,
  type StorageAccess,
} from '../file-signature.js'

const SECRET = 'a'.repeat(MIN_SIGNING_SECRET_LENGTH)
const OTHER_SECRET = 'b'.repeat(MIN_SIGNING_SECRET_LENGTH)
const EXPIRES_AT_SEC = 1_800_000_000
const NOW_MS = EXPIRES_AT_SEC * 1000 - 60_000

const GET_ACCESS: StorageAccess = {
  method: 'GET',
  key: 'media/01ABC/01DEF/original.mp4',
  expiresAtSec: EXPIRES_AT_SEC,
}

const verify = (access: StorageAccess, signature: string, nowMs = NOW_MS, secret = SECRET) =>
  verifyStorageAccess({ ...access, signature, nowMs }, secret)

describe('signStorageAccess', () => {
  it('同じ入力なら同じ署名（URL が頼むたびに変わらない）', () => {
    expect(signStorageAccess(GET_ACCESS, SECRET)).toBe(signStorageAccess(GET_ACCESS, SECRET))
  })

  it('読む署名と書く署名は別のものになる', () => {
    const get = signStorageAccess(GET_ACCESS, SECRET)
    const put = signStorageAccess({ ...GET_ACCESS, method: 'PUT', contentType: 'video/mp4' }, SECRET)

    expect(get).not.toBe(put)
  })

  /** 鍵が短いまま動くと、署名があるのに破れる。**破る値の検査を置く。** */
  it('鍵が短ければ署名を作らない', () => {
    const tooShort = 'a'.repeat(MIN_SIGNING_SECRET_LENGTH - 1)

    expect(() => signStorageAccess(GET_ACCESS, tooShort)).toThrow('短すぎます')
  })
})

describe('verifyStorageAccess', () => {
  it('正しい署名は通る', () => {
    expect(verify(GET_ACCESS, signStorageAccess(GET_ACCESS, SECRET))).toEqual({ ok: true })
  })

  it('期限ちょうどは通る（1 秒過ぎたら切れる）', () => {
    const signature = signStorageAccess(GET_ACCESS, SECRET)

    expect(verify(GET_ACCESS, signature, EXPIRES_AT_SEC * 1000)).toEqual({ ok: true })
    expect(verify(GET_ACCESS, signature, (EXPIRES_AT_SEC + 1) * 1000)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('鍵が違えば通らない', () => {
    const signature = signStorageAccess(GET_ACCESS, SECRET)

    expect(verify(GET_ACCESS, signature, NOW_MS, OTHER_SECRET)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  /**
   * 署名を先に見ているかの確認。**期限を書き換えただけの URL は `expired` ではなく `mismatch`。**
   * 期限を先に見ていると、改竄を「ただ切れただけ」と読み違える。
   */
  it('期限を書き換えた URL は mismatch（expired ではない）', () => {
    const signature = signStorageAccess(GET_ACCESS, SECRET)

    // 伸ばした（まだ切れていない時刻）
    expect(verify({ ...GET_ACCESS, expiresAtSec: EXPIRES_AT_SEC + 86_400 }, signature)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
    // 過ぎた時刻へ書き換えた。**期限を先に見ていると、ここが expired に化けて改竄と見分けが付かない。**
    expect(verify({ ...GET_ACCESS, expiresAtSec: EXPIRES_AT_SEC - 7_200 }, signature)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it.each([
    { name: 'key', access: { ...GET_ACCESS, key: 'media/01ABC/01DEF/other.mp4' } },
    { name: '向き（読む→書く）', access: { ...GET_ACCESS, method: 'PUT' as const } },
    { name: '型を足す', access: { ...GET_ACCESS, contentType: 'video/mp4' } },
  ])('$name を書き換えた URL は通らない', ({ access }) => {
    expect(verify(access, signStorageAccess(GET_ACCESS, SECRET))).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('署名が空・長さ違いでも落ちずに mismatch を返す', () => {
    expect(verify(GET_ACCESS, '')).toEqual({ ok: false, reason: 'mismatch' })
    expect(verify(GET_ACCESS, 'deadbeef')).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('書く署名は型まで含めて一致したときだけ通る', () => {
    const put = { ...GET_ACCESS, method: 'PUT' as const, contentType: 'video/mp4' }
    const signature = signStorageAccess(put, SECRET)

    expect(verify(put, signature)).toEqual({ ok: true })
    expect(verify({ ...put, contentType: 'text/html' }, signature)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })
})
