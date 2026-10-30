import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCoalescedReload } from '@/components/workbench/use-coalesced-reload'

/**
 * 外の書き込み（MCP の `edit_clips` は 1 件ずつ 99 回）を、読み直し 1 回にまとめる。
 * 書き込みが続いても、待ちすぎずに途中で 1 回は読み直す。
 */
describe('useCoalescedReload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('続けて来た合図は、止んでから 1 回だけ読み直す', () => {
    const reload = vi.fn()
    const { result } = renderHook(() => useCoalescedReload(reload, { quietMs: 500, maxWaitMs: 3000 }))
    act(() => {
      for (let i = 0; i < 5; i += 1) {
        result.current()
        vi.advanceTimersByTime(100)
      }
    })
    expect(reload).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('合図が途切れなくても、待ちの上限で読み直す', () => {
    const reload = vi.fn()
    const { result } = renderHook(() => useCoalescedReload(reload, { quietMs: 500, maxWaitMs: 3000 }))
    act(() => {
      for (let i = 0; i < 40; i += 1) {
        result.current()
        vi.advanceTimersByTime(100)
      }
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('外したら読み直さない', () => {
    const reload = vi.fn()
    const { result, unmount } = renderHook(() => useCoalescedReload(reload, { quietMs: 500, maxWaitMs: 3000 }))
    act(() => {
      result.current()
    })
    unmount()
    vi.advanceTimersByTime(5000)
    expect(reload).not.toHaveBeenCalled()
  })
})
