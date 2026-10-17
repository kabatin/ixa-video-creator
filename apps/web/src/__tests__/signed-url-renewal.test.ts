import { describe, expect, it } from 'vitest'
import {
  MIN_RENEW_DELAY_MS,
  RENEW_AFTER_ERROR_MIN_AGE_MS,
  mayRenewAfterError,
  renewDelayMs,
} from '@/lib/signed-url-renewal'

/** 2026-10-18「ワークベンチを開いたままだと素材が読めなくなる」。取り直しの時刻と、失敗で取り直してよいか。 */
describe('renewDelayMs', () => {
  it('有効期間の 8 割で取り直す（300 秒なら 240 秒、1 時間なら 48 分）', () => {
    expect(renewDelayMs(300)).toBe(240_000)
    expect(renewDelayMs(3600)).toBe(2_880_000)
  })

  it('期限より前に必ず取り直す', () => {
    for (const sec of [30, 300, 900, 3600]) expect(renewDelayMs(sec)).toBeLessThan(sec * 1_000)
  })

  it('極端に短い・壊れた期限でも叩き続けない（床がある）', () => {
    expect(renewDelayMs(1)).toBe(MIN_RENEW_DELAY_MS)
    expect(renewDelayMs(0)).toBe(MIN_RENEW_DELAY_MS)
    expect(renewDelayMs(Number.NaN)).toBe(MIN_RENEW_DELAY_MS)
    expect(renewDelayMs(-5)).toBe(MIN_RENEW_DELAY_MS)
  })
})

describe('mayRenewAfterError', () => {
  const at = 1_000_000

  it('取ったばかりの URL で読めないなら取り直さない（素材そのものが無い。回り続けない）', () => {
    expect(mayRenewAfterError(at, at)).toBe(false)
    expect(mayRenewAfterError(at, at + RENEW_AFTER_ERROR_MIN_AGE_MS - 1)).toBe(false)
  })

  it('取ってから 1 分を過ぎていれば取り直す（期限切れ）', () => {
    expect(mayRenewAfterError(at, at + RENEW_AFTER_ERROR_MIN_AGE_MS)).toBe(true)
    expect(mayRenewAfterError(at, at + 300_000)).toBe(true)
  })

  it('取り直している最中（null）は頼まない', () => {
    expect(mayRenewAfterError(null, at + 10_000_000)).toBe(false)
  })

  it('1 分は最短の期限（300 秒）より十分短い', () => {
    expect(RENEW_AFTER_ERROR_MIN_AGE_MS).toBeLessThan(renewDelayMs(300))
  })
})
