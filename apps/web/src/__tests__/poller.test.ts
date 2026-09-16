import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS, decidePoll, startPolling } from '@/lib/poller'

const baseState = {
  startedAtMs: 0,
  nowMs: 0,
  stopped: false,
  running: true,
}

describe('decidePoll', () => {
  it('動いている間は継続する', () => {
    expect(decidePoll({ ...baseState, nowMs: 60_000 })).toEqual({ kind: 'continue' })
  })

  it('明示的に止められたら stopped で止まる', () => {
    expect(decidePoll({ ...baseState, stopped: true })).toEqual({
      kind: 'stop',
      reason: 'stopped',
    })
  })

  it('監視対象が終わっていたら settled で止まる', () => {
    expect(decidePoll({ ...baseState, running: false })).toEqual({
      kind: 'stop',
      reason: 'settled',
    })
  })

  it('上限時間に達したら timeout で止まる', () => {
    expect(decidePoll({ ...baseState, nowMs: POLL_TIMEOUT_MS })).toEqual({
      kind: 'stop',
      reason: 'timeout',
    })
  })

  it('上限の 1ms 手前では止まらない', () => {
    expect(decidePoll({ ...baseState, nowMs: POLL_TIMEOUT_MS - 1 })).toEqual({ kind: 'continue' })
  })

  it('停止は上限時間より優先される', () => {
    expect(decidePoll({ ...baseState, nowMs: POLL_TIMEOUT_MS, stopped: true })).toEqual({
      kind: 'stop',
      reason: 'stopped',
    })
  })
})

describe('startPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('一定間隔で onTick を呼ぶ', () => {
    const onTick = vi.fn()
    const handle = startPolling({ onTick })

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)

    expect(onTick).toHaveBeenCalledTimes(3)
    handle.stop()
  })

  it('上限時間に達したら自分で止まり、以後は二度と呼ばれない', () => {
    const onTick = vi.fn()
    const onStop = vi.fn()
    startPolling({ onTick, onStop })

    vi.advanceTimersByTime(POLL_TIMEOUT_MS)
    const callsAtTimeout = onTick.mock.calls.length

    vi.advanceTimersByTime(POLL_TIMEOUT_MS * 2)

    expect(onStop).toHaveBeenCalledWith('timeout')
    expect(onTick).toHaveBeenCalledTimes(callsAtTimeout)
    expect(callsAtTimeout).toBe(POLL_TIMEOUT_MS / POLL_INTERVAL_MS - 1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop() を呼んだら以後 onTick は呼ばれない', () => {
    const onTick = vi.fn()
    const handle = startPolling({ onTick })

    vi.advanceTimersByTime(POLL_INTERVAL_MS)
    handle.stop()
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 100)

    expect(onTick).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop() は何度呼んでも安全', () => {
    const handle = startPolling({ onTick: vi.fn() })

    handle.stop()
    handle.stop()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('短い上限時間でも必ず止まる', () => {
    const onTick = vi.fn()
    const onStop = vi.fn()
    startPolling({ onTick, onStop, intervalMs: 10, timeoutMs: 25 })

    vi.advanceTimersByTime(1_000)

    expect(onTick).toHaveBeenCalledTimes(2)
    expect(onStop).toHaveBeenCalledWith('timeout')
    expect(vi.getTimerCount()).toBe(0)
  })
})
