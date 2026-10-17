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

const renderCover = () =>
  render(
    <PosterRenewalOnRefresh>
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

  it('描いたばかりの URL で読めないなら描き直さない（絵そのものが無い。回り続けない）', () => {
    renderCover()
    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    fireEvent.error(screen.getByRole('img', { name: '表紙' }))

    expect(refresh).not.toHaveBeenCalled()
  })
})
