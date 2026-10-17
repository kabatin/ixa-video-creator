import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUrlRenewal } from '@/lib/use-url-renewal'

/** タイムラインと Take 比較の材料（URL 1 時間）を、切れる前と読めなかったときに取り直す合図。 */

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useUrlRenewal', () => {
  it('取れてから有効期間の 8 割で取り直す', () => {
    const { result } = renderHook(() => useUrlRenewal(3600))
    act(() => {
      result.current.markLoaded()
    })

    act(() => {
      vi.advanceTimersByTime(2_880_000 - 1)
    })
    expect(result.current.epoch).toBe(0)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.epoch).toBe(1)
  })

  it('取れる前は時刻で取り直さない', () => {
    const { result } = renderHook(() => useUrlRenewal(3600))
    act(() => {
      vi.advanceTimersByTime(10_000_000)
    })
    expect(result.current.epoch).toBe(0)
  })

  it('読めなかったら取り直す。ただし取ってから 1 分は頼まない', () => {
    const { result } = renderHook(() => useUrlRenewal(3600))
    act(() => {
      result.current.markLoaded()
    })

    act(() => {
      vi.advanceTimersByTime(59_000)
      result.current.renewAfterError()
    })
    expect(result.current.epoch).toBe(0)

    act(() => {
      vi.advanceTimersByTime(1_000)
      result.current.renewAfterError()
    })
    expect(result.current.epoch).toBe(1)
  })

  it('取り直している間に続けて読めなくても 1 回しか頼まない', () => {
    const { result } = renderHook(() => useUrlRenewal(3600))
    act(() => {
      result.current.markLoaded()
      vi.advanceTimersByTime(120_000)
    })

    act(() => {
      result.current.renewAfterError()
      result.current.renewAfterError()
      result.current.renewAfterError()
    })
    expect(result.current.epoch).toBe(1)
  })

  it('読めなくて取り直したら、前の時刻の取り直しは捨てる（二重に取らない）', () => {
    const { result } = renderHook(() => useUrlRenewal(3600))
    act(() => {
      result.current.markLoaded()
      vi.advanceTimersByTime(120_000)
      result.current.renewAfterError()
    })
    expect(result.current.epoch).toBe(1)

    act(() => {
      vi.advanceTimersByTime(2_880_000)
    })
    expect(result.current.epoch).toBe(1)
  })

  it('画面を離れたら取り直さない', () => {
    const { result, unmount } = renderHook(() => useUrlRenewal(3600))
    act(() => {
      result.current.markLoaded()
    })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
