import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosterRenewalOnRefresh } from '@/components/poster-renewal-on-refresh'
import { ShotPoster } from '@/components/shot-poster'

/**
 * プロジェクト一覧の表紙（サーバが描いた署名付き URL、5 分）が読めなくなったら、ページを描き直してもらう（2026-10-18）。
 * 以前は引き直す持ち主がおらず、開いたまま 5 分を過ぎると「読み込めません」のまま残った。
 */

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const START = new Date('2026-10-18T00:00:00Z').getTime()

const renderCover = (issuedAtMs = START) =>
  render(
    <PosterRenewalOnRefresh issuedAtMs={issuedAtMs}>
      <ShotPoster url="https://example.invalid/cover.jpg" reason={null} alt="表紙" size="card" />
    </PosterRenewalOnRefresh>,
  )

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'))
  refresh.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PosterRenewalOnRefresh', () => {
  it('期限切れで読めなかったらページを描き直す', () => {
    renderCover()
    act(() => {
      vi.advanceTimersByTime(330_000)
    })

    fireEvent.error(screen.getByRole('img', { name: '表紙' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  /**
   * 戻るボタンで出た古いページ（Router Cache）。URL は 10 分前に発行されたもので、画面に出てすぐ全部読めない。
   * 画面に出た時刻から数えていた頃は「描いたばかりで読めない」と読み違え、二度と描き直さなかった。
   */
  it('古いページ（URL を発行して 10 分）なら、画面に出てすぐ読めなくても描き直す', () => {
    renderCover(START - 600_000)

    fireEvent.error(screen.getByRole('img', { name: '表紙' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('同じページの URL では 1 回しか頼まない（新しいページが届くまで何枚読めなくても）', () => {
    render(
      <PosterRenewalOnRefresh issuedAtMs={START - 600_000}>
        <ShotPoster url="https://example.invalid/a.jpg" reason={null} alt="表紙 A" size="card" />
        <ShotPoster url="https://example.invalid/b.jpg" reason={null} alt="表紙 B" size="card" />
      </PosterRenewalOnRefresh>,
    )

    fireEvent.error(screen.getByRole('img', { name: '表紙 A' }))
    fireEvent.error(screen.getByRole('img', { name: '表紙 B' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('描いたばかりの URL で読めないなら描き直さない（絵そのものが無い。回り続けない）', () => {
    renderCover()
    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    fireEvent.error(screen.getByRole('img', { name: '表紙' }))

    expect(refresh).not.toHaveBeenCalled()
  })
})
