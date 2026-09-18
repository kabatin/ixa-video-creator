import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveStatusBadge } from '@/components/live-status-badge'
import { describeLiveState, type LiveState } from '@/lib/project-events'

/**
 * 「繋がっていない」は読み上げまで届かせる。
 * 表示が古い可能性を伝えないと、一覧は最新に見えてしまう（lessons L-015）。
 */

const AT = '2026-09-18T10:00:00.000Z'

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveStatusBadge', () => {
  const cases: readonly (readonly [LiveState, string])[] = [
    ['connecting', 'status'],
    ['live', 'status'],
    ['reconnecting', 'alert'],
    ['stopped', 'alert'],
  ]

  for (const [state, role] of cases) {
    it(`${state} は role="${role}"`, () => {
      render(<LiveStatusBadge state={state} lastEventAt={null} attempt={1} />)
      const badge = screen.getByRole(role)
      expect(badge).toHaveTextContent(describeLiveState(state, { lastEventAt: null, attempt: 1 }).headline)
    })
  }

  it('繋がっていない間は表示が古い可能性を読み上げる', () => {
    render(<LiveStatusBadge state="stopped" lastEventAt={null} attempt={0} />)
    expect(screen.getByRole('alert')).toHaveTextContent('古い可能性')
  })

  it('最初の描画では経過時間を出さない', () => {
    // Date.now() はサーバとブラウザで違う。1 回目に出すと木ごと作り直しになる（lessons L-019）。
    const html = renderToStaticMarkup(<LiveStatusBadge state="live" lastEventAt={AT} attempt={0} />)
    expect(html).not.toContain('最終更新')
  })

  it('描画のあとで経過時間が出る', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse(AT) + 12_000))

    render(<LiveStatusBadge state="live" lastEventAt={AT} attempt={0} />)

    expect(screen.getByRole('status')).toHaveTextContent('最終更新 0:00:12 前')
  })

  it('最終時刻が無ければ経過時間を出さない', () => {
    vi.useFakeTimers()
    render(<LiveStatusBadge state="live" lastEventAt={null} attempt={0} />)
    expect(screen.getByRole('status')).not.toHaveTextContent('最終更新')
  })
})
