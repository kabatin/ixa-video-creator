import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ERROR_DECODE, MEDIA_ERROR_NETWORK } from '@/lib/playback-state'
import { useRenewableMediaSrc } from '@/lib/use-renewable-media-src'

/**
 * `<video>` / `<audio>` の URL が切れたら取り直して同じ位置から続ける（2026-10-18）。
 * 書き出しの再生・声の試聴・Take のカードが使う。
 */

const Harness = ({ url, reload }: { readonly url: string | null; readonly reload: () => Promise<string> }) => {
  const { mediaProps, error } = useRenewableMediaSrc({ url, reload, label: '動画' })
  return (
    <div>
      {mediaProps !== null && <video data-testid="video" {...mediaProps} />}
      {error !== null && <p role="alert">{error}</p>}
    </div>
  )
}

const video = (): HTMLVideoElement => screen.getByTestId('video')

/** jsdom の要素は再生も読み込みもしないので、失敗と位置を手で置く。 */
const failWith = (element: HTMLVideoElement, code: number, atSec: number): void => {
  Object.defineProperty(element, 'error', { configurable: true, value: { code } })
  Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: atSec })
  fireEvent.error(element)
}

const recover = (element: HTMLVideoElement): void => {
  Object.defineProperty(element, 'error', { configurable: true, value: null })
  Object.defineProperty(element, 'duration', { configurable: true, value: 120 })
  // 差し替えた要素は頭から読み直す。
  element.currentTime = 0
  fireEvent.loadedMetadata(element)
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useRenewableMediaSrc', () => {
  it('時刻では差し替えない（見ている途中で頭へ戻さない）', () => {
    const reload = vi.fn(() => Promise.resolve('https://example.invalid/new'))
    render(<Harness url="https://example.invalid/first" reload={reload} />)

    act(() => {
      vi.advanceTimersByTime(600_000)
    })

    expect(reload).not.toHaveBeenCalled()
    expect(video().getAttribute('src')).toBe('https://example.invalid/first')
  })

  it('期限切れで読めなくなったら取り直し、同じ位置から再生を続ける', async () => {
    const reload = vi.fn(() => Promise.resolve('https://example.invalid/new'))
    render(<Harness url="https://example.invalid/first" reload={reload} />)
    const play = vi.spyOn(video(), 'play').mockResolvedValue(undefined)
    fireEvent.play(video())

    act(() => {
      vi.advanceTimersByTime(330_000)
    })
    failWith(video(), MEDIA_ERROR_NETWORK, 95.5)
    await flush()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(video().getAttribute('src')).toBe('https://example.invalid/new')

    recover(video())
    expect(video().currentTime).toBe(95.5)
    expect(play).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('止めていたものは止めたまま戻す（autoPlay でも勝手に鳴らさない）', async () => {
    const reload = vi.fn(() => Promise.resolve('https://example.invalid/new'))
    render(<Harness url="https://example.invalid/first" reload={reload} />)
    const play = vi.spyOn(video(), 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(video(), 'pause').mockImplementation(() => undefined)

    act(() => {
      vi.advanceTimersByTime(330_000)
    })
    failWith(video(), MEDIA_ERROR_NETWORK, 42)
    await flush()
    recover(video())

    expect(video().currentTime).toBe(42)
    expect(play).not.toHaveBeenCalled()
    expect(pause).toHaveBeenCalled()
  })

  it('取ったばかりの URL で読めないなら取り直さず理由を出す（回り続けない）', async () => {
    const reload = vi.fn(() => Promise.resolve('https://example.invalid/new'))
    render(<Harness url="https://example.invalid/first" reload={reload} />)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    failWith(video(), MEDIA_ERROR_NETWORK, 0)
    await flush()

    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('動画を読み込めませんでした。')
  })

  it('壊れたファイル（取り直しても直らない失敗）では取り直さない', async () => {
    const reload = vi.fn(() => Promise.resolve('https://example.invalid/new'))
    render(<Harness url="https://example.invalid/first" reload={reload} />)

    act(() => {
      vi.advanceTimersByTime(330_000)
    })
    failWith(video(), MEDIA_ERROR_DECODE, 0)
    await flush()

    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('取り直した URL でもすぐ読めなければ、もう取り直さない', async () => {
    const reload = vi.fn(() => Promise.resolve('https://example.invalid/new'))
    render(<Harness url="https://example.invalid/first" reload={reload} />)

    act(() => {
      vi.advanceTimersByTime(330_000)
    })
    failWith(video(), MEDIA_ERROR_NETWORK, 10)
    await flush()
    failWith(video(), MEDIA_ERROR_NETWORK, 10)
    await flush()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('取り直せなかったら理由を出す', async () => {
    const reload = vi.fn(() => Promise.reject(new Error('HTTP 500')))
    render(<Harness url="https://example.invalid/first" reload={reload} />)

    act(() => {
      vi.advanceTimersByTime(330_000)
    })
    failWith(video(), MEDIA_ERROR_NETWORK, 10)
    await flush()

    expect(screen.getByRole('alert').textContent).toContain('動画の一時 URL を取り直せませんでした')
  })

  /**
   * 取り直している間に閉じた（書き出しの「閉じる」）・作り直した（声の試聴をもう一度）。
   * 以前は古い結果がそのまま入り、閉じた動画が開き直して鳴り出し、新しい声が前の声に戻った。
   */
  it('取り直している間に URL が変わったら、古い結果で上書きしない', async () => {
    let resolveReload: (url: string) => void = () => undefined
    const reload = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveReload = resolve
        }),
    )
    const { rerender } = render(<Harness url="https://example.invalid/first" reload={reload} />)
    act(() => {
      vi.advanceTimersByTime(330_000)
    })
    failWith(video(), MEDIA_ERROR_NETWORK, 10)
    expect(reload).toHaveBeenCalledTimes(1)

    rerender(<Harness url={null} reload={reload} />)
    await act(async () => {
      resolveReload('https://example.invalid/stale')
      await Promise.resolve()
    })
    expect(screen.queryByTestId('video')).toBeNull()

    rerender(<Harness url="https://example.invalid/next" reload={reload} />)
    expect(video().getAttribute('src')).toBe('https://example.invalid/next')
  })

  /** 閉じた動画を 1 コマでも描かない（以前は effect で写していたため 1 描画遅れた）。 */
  it('URL が変わったその描画から新しい URL を使う', () => {
    const seen: (string | null)[] = []
    const Probe = ({ url }: { readonly url: string | null }) => {
      const { mediaProps } = useRenewableMediaSrc({ url, reload: () => Promise.resolve(''), label: '動画' })
      seen.push(mediaProps?.src ?? null)
      return null
    }
    const { rerender } = render(<Probe url="https://example.invalid/first" />)
    seen.length = 0

    rerender(<Probe url={null} />)

    expect(seen).not.toContain('https://example.invalid/first')
    expect(seen.at(-1)).toBeNull()
  })
})
