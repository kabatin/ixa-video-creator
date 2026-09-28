import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AudioPlayback } from '@/lib/use-audio-playback'
import { useCutEditorSync, type TransportSyncPort } from '@/lib/use-cut-editor-sync'

/**
 * 聴きながら切るで利用者が飛んだ位置は、**共有の位置へのシーク**として伝える。
 *
 * 以前は波形のクリック・再生位置のスライダー・印へのジャンプが、この再生器の中だけで位置を動かしていた。
 * プレビューが鳴っている間は共有の位置へ合わせ直す（followSec）ので、押した位置から
 * 鳴っている位置へ引き戻され、ガタついて見えた（2026-09-28、制作者の指摘）。
 */
const fakePlayback = (overrides: Partial<AudioPlayback> = {}): AudioPlayback =>
  ({
    source: null,
    isPlaying: false,
    currentSec: 10,
    durationSec: 100,
    isLoading: false,
    error: null,
    notice: null,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    seekTo: vi.fn(),
    nudge: vi.fn(),
    volume: 1,
    muted: false,
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    ...overrides,
  }) as unknown as AudioPlayback

const port = (overrides: Partial<TransportSyncPort> = {}): TransportSyncPort => ({
  othersPlaying: true,
  seek: null,
  onPosition: vi.fn(),
  onPlayingChange: vi.fn(),
  onSeek: vi.fn(),
  followSec: 10,
  ...overrides,
})

describe('useCutEditorSync が返す操作', () => {
  it('利用者の seekTo は自分の再生器を動かし、共有の位置へも飛ばす', () => {
    const playback = fakePlayback()
    const sync = port()
    const { result } = renderHook(() => useCutEditorSync(playback, sync))

    result.current.seekTo(42)

    expect(playback.seekTo).toHaveBeenCalledWith(42)
    expect(sync.onSeek).toHaveBeenCalledWith(42)
  })

  it('nudge も同じく、動かした先を共有の位置へ伝える（範囲の外へは出ない）', () => {
    const playback = fakePlayback({ currentSec: 98 })
    const sync = port({ followSec: 98 })
    const { result } = renderHook(() => useCutEditorSync(playback, sync))

    result.current.nudge(5)

    expect(playback.seekTo).toHaveBeenCalledWith(100)
    expect(sync.onSeek).toHaveBeenCalledWith(100)
  })

  it('共有の位置へ付いていく動き（followSec）では伝え返さない（往復させない）', () => {
    const playback = fakePlayback({ currentSec: 10 })
    const sync = port({ othersPlaying: false, followSec: 10 })
    const { rerender } = renderHook(({ s }) => useCutEditorSync(playback, s), { initialProps: { s: sync } })

    rerender({ s: { ...sync, followSec: 30 } })

    expect(playback.seekTo).toHaveBeenCalledWith(30)
    expect(sync.onSeek).not.toHaveBeenCalled()
  })
})

/**
 * **他が鳴っている間は、自分の再生器を動かさずに見せる位置だけ付いていく。**
 *
 * 以前は止まっている音声を 1 秒に 8 回ほど頭出しし直していた。そのたびに読み込みと描き直しが走り、
 * 主スレッドが詰まって、鳴っているプレビューの音が巻き戻った（2026-09-28 実測）。
 */
describe('他が鳴っている間の付いていき方', () => {
  it('再生器は動かさず、見せる位置だけ共有の位置にする', () => {
    const playback = fakePlayback({ currentSec: 10 })
    const sync = port({ followSec: 10 })
    const { result, rerender } = renderHook(({ s }) => useCutEditorSync(playback, s), {
      initialProps: { s: sync },
    })

    rerender({ s: { ...sync, followSec: 30 } })

    expect(playback.seekTo).not.toHaveBeenCalled()
    expect(result.current.currentSec).toBe(30)
  })

  it('他が止まったら、そのときの位置へ 1 回だけ合わせる', () => {
    const playback = fakePlayback({ currentSec: 10 })
    const sync = port({ followSec: 30 })
    const { rerender } = renderHook(({ s }) => useCutEditorSync(playback, s), {
      initialProps: { s: sync },
    })

    rerender({ s: { ...sync, othersPlaying: false } })

    expect(playback.seekTo).toHaveBeenCalledTimes(1)
    expect(playback.seekTo).toHaveBeenCalledWith(30)
  })

  it('矢印キーの 1 歩は、見えている位置から動かす', () => {
    const playback = fakePlayback({ currentSec: 10 })
    const sync = port({ followSec: 98 })
    const { result } = renderHook(() => useCutEditorSync(playback, sync))

    result.current.nudge(5)

    expect(sync.onSeek).toHaveBeenCalledWith(100)
  })
})

describe('単体で使うとき', () => {
  it('単体で使うとき（sync なし）は自分の再生器だけを動かす', () => {
    const playback = fakePlayback()
    const { result } = renderHook(() => useCutEditorSync(playback, undefined))

    result.current.seekTo(3)

    expect(playback.seekTo).toHaveBeenCalledWith(3)
  })
})
