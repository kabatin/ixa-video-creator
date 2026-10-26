import { describe, expect, it } from 'vitest'
import { dbErrorReason, isUnreachable } from '../lib/db-error.js'

const withCode = (code: string): Error => Object.assign(new Error('x'), { code })

describe('isUnreachable（DB が動いていないだけか）', () => {
  it('つながらない・時間切れは「動いていない」', () => {
    expect(isUnreachable(withCode('ECONNREFUSED'))).toBe(true)
    expect(isUnreachable(withCode('CONNECT_TIMEOUT'))).toBe(true)
    expect(isUnreachable(withCode('ETIMEDOUT'))).toBe(true)
  })

  it('包まれていても cause をたどる', () => {
    expect(isUnreachable(new Error('数えられませんでした', { cause: withCode('ECONNREFUSED') }))).toBe(true)
  })

  it('理由は code だけ。2 重に包まれていてもたどる', () => {
    const wrapped = new Error('数えられませんでした', { cause: new Error('Failed query', { cause: withCode('28P01') }) })
    expect(dbErrorReason(wrapped)).toBe('読めません（28P01）')
    expect(dbErrorReason(new Error('x', { cause: new Error('y', { cause: withCode('ECONNREFUSED') }) }))).toBe('つながりません')
  })

  it('合言葉違い・表が無い・名前を引けないなどは「動いていない」ではない（止める）', () => {
    expect(isUnreachable(withCode('28P01'))).toBe(false)
    expect(isUnreachable(withCode('42P01'))).toBe(false)
    expect(isUnreachable(withCode('ENOTFOUND'))).toBe(false)
    expect(isUnreachable(new Error('connect のついた文でも code が無ければ違う'))).toBe(false)
  })
})
