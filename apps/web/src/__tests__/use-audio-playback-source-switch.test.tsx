import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignedSource } from '@/lib/playback-state'
import { useAudioPlayback } from '@/lib/use-audio-playback'
import { PreferencesWrapper } from './preferences-wrapper'

/**
 * 鳴っている途中で音源を替えたら「再生中」が残らない（制作者 2026-10-19「再生中に他の音源に切り替えると
 * 『再生』ボタンが『一時停止』になったままになる」）。
 *
 * 要素の `pause()` は `paused` をその場で立て、`pause` の行事は後で届ける。その前に `load()` が走ると
 * **届く前の行事は捨てられる**（HTML の media element load algorithm）。jsdom はこれを真似ないので、
 * 仕様どおりに行事を貯めて捨てる偽の要素で確かめる。
 */
class SpecAudio extends EventTarget {
  static last: SpecAudio | null = null
  paused = true
  currentTime = 0
  duration = Number.NaN
  error: MediaError | null = null
  volume = 1
  muted = false
  preload = ''
  src = ''
  private queued: string[] = []

  constructor() {
    super()
    SpecAudio.last = this
  }

  play(): Promise<void> {
    if (this.paused) {
      this.paused = false
      this.queued = [...this.queued, 'play']
    }
    return Promise.resolve()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.queued = [...this.queued, 'pause']
  }

  load(): void {
    // 届く前の行事を捨て、鳴っていれば黙って止める（`pause` は出さない）。
    this.queued = ['emptied']
    this.paused = true
  }

  removeAttribute(): void {
    this.src = ''
  }

  /** 貯めた行事を届ける（ブラウザの次の仕事）。 */
  flush(): void {
    const events = this.queued
    this.queued = []
    events.forEach((name) => this.dispatchEvent(new Event(name)))
  }
}

const sourceA: SignedSource = { url: 'https://example.invalid/a', expiresInSec: 3600 }
const sourceB: SignedSource = { url: 'https://example.invalid/b', expiresInSec: 3600 }

beforeEach(() => {
  vi.stubGlobal('Audio', SpecAudio)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  SpecAudio.last = null
})

describe('音源の差し替え', () => {
  it('止めた行事が届く前に音源を替えても「再生中」が残らない', () => {
    const { result, rerender } = renderHook(({ source }) => useAudioPlayback({ source }), {
      wrapper: PreferencesWrapper,
      initialProps: { source: sourceA },
    })
    const audio = SpecAudio.last
    if (audio === null) throw new Error('要素が作られていません')

    act(() => {
      result.current.play()
      audio.flush()
    })
    expect(result.current.isPlaying).toBe(true)

    // 素材ビューアで別の音を選んだ: 止めてから、行事が届く前に次の URL が流し込まれる。
    act(() => {
      result.current.pause()
    })
    rerender({ source: sourceB })
    act(() => {
      audio.flush()
    })

    expect(audio.paused).toBe(true)
    expect(result.current.isPlaying).toBe(false)
  })

  it('期限前の取り直しで続きから鳴らすあいだは「再生中」を保つ', async () => {
    vi.useFakeTimers()
    const refreshed: SignedSource = { url: 'https://example.invalid/a2', expiresInSec: 3600 }
    const onRefreshSource = vi.fn().mockResolvedValue(refreshed)
    const { result } = renderHook(() => useAudioPlayback({ source: sourceA, onRefreshSource }), {
      wrapper: PreferencesWrapper,
    })
    const audio = SpecAudio.last
    if (audio === null) throw new Error('要素が作られていません')
    act(() => {
      result.current.play()
      audio.flush()
    })

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    expect(audio.src).toBe(refreshed.url)
    expect(result.current.isPlaying).toBe(true)
    vi.useRealTimers()
  })
})
