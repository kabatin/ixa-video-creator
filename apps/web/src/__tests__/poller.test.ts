import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  decidePoll,
  startAsyncPolling,
  startPolling,
} from '@/lib/poller'

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

/** 問い合わせ 1 回分の戻り。テストの中で握った resolve へ渡すために型を固定する。 */
type Probe = { readonly running: boolean; readonly value: string }

describe('startAsyncPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('終わるまで問い合わせ、終わったら settled として止まる', async () => {
    const onSettled = vi.fn()
    const onTimeout = vi.fn()
    const onFailed = vi.fn()
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ running: true, value: 'queued' })
      .mockResolvedValueOnce({ running: false, value: 'done' })

    startAsyncPolling({ probe, onSettled, onTimeout, onFailed })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)

    expect(probe).toHaveBeenCalledTimes(2)
    expect(onSettled).toHaveBeenCalledWith('done')
    expect(onTimeout).not.toHaveBeenCalled()
    expect(onFailed).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('動いている間の結果も毎回渡す', async () => {
    const seen: string[] = []
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ running: true, value: 'queued' })
      .mockResolvedValueOnce({ running: true, value: 'running' })
      .mockResolvedValue({ running: false, value: 'done' })

    startAsyncPolling<string>({
      probe,
      onProbe: (result) => {
        seen.push(result.value)
      },
    })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)

    expect(seen).toEqual(['queued', 'running', 'done'])
  })

  it('上限に達したら timeout で止まる。settled と混ぜない', async () => {
    const onSettled = vi.fn()
    const onTimeout = vi.fn()
    const probe = vi.fn().mockResolvedValue({ running: true, value: null })

    startAsyncPolling({ probe, onSettled, onTimeout, intervalMs: 10, timeoutMs: 25 })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(probe).toHaveBeenCalledTimes(2)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onSettled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('既定の上限は 5 分。無限に叩き続けない', async () => {
    const probe = vi.fn().mockResolvedValue({ running: true, value: null })
    const onTimeout = vi.fn()

    startAsyncPolling({ probe, onTimeout })
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS * 3)

    expect(probe).toHaveBeenCalledTimes(POLL_TIMEOUT_MS / POLL_INTERVAL_MS - 1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('問い合わせが失敗したら failed で止まる。握り潰さない', async () => {
    const onFailed = vi.fn()
    const onSettled = vi.fn()
    const failure = new Error('接続できません')
    const probe = vi.fn().mockRejectedValue(failure)

    startAsyncPolling({ probe, onFailed, onSettled })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)

    expect(probe).toHaveBeenCalledTimes(1)
    expect(onFailed).toHaveBeenCalledWith(failure)
    expect(onSettled).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('前の問い合わせが返るまで次を撃たない', async () => {
    const pending: { resolve: ((value: Probe) => void) | null } = { resolve: null }
    const probe = vi.fn().mockImplementation(
      async () =>
        new Promise<Probe>((resolve) => {
          pending.resolve = resolve
        }),
    )

    startAsyncPolling({ probe })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4)

    expect(probe).toHaveBeenCalledTimes(1)
    pending.resolve?.({ running: false, value: 'done' })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop() を呼んだら以後 probe も通知も起きない', async () => {
    const probe = vi.fn().mockResolvedValue({ running: true, value: null })
    const onProbe = vi.fn()
    const handle = startAsyncPolling({ probe, onProbe })

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    handle.stop()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 100)

    expect(probe).toHaveBeenCalledTimes(1)
    expect(onProbe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('問い合わせ中に止めたら、返ってきた結果は捨てる', async () => {
    const pending: { resolve: ((value: Probe) => void) | null } = { resolve: null }
    const probe = vi.fn().mockImplementation(
      async () =>
        new Promise<Probe>((resolve) => {
          pending.resolve = resolve
        }),
    )
    const onProbe = vi.fn()
    const onSettled = vi.fn()

    const handle = startAsyncPolling({ probe, onProbe, onSettled })
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    handle.stop()
    pending.resolve?.({ running: false, value: 'done' })
    await vi.advanceTimersByTimeAsync(0)

    expect(onProbe).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
  })
})
