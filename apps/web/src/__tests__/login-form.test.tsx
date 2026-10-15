import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from '@/components/login-form'

/**
 * 合言葉を決めていなければ、聞かずに入る（制作者 2026-10-16
 * 「初めて触るひとはいきなり認証画面出てきたら拒否反応出しそう」）。
 */

const TOKEN = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  kind: 'browser',
  label: 'ブラウザ',
  createdAt: '2026-10-16T00:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
}

const stubApi = (passphraseRequired: boolean) => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: url.endsWith('/auth/status') ? { passphraseRequired } : TOKEN,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  const assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign, hostname: 'localhost' })
  return { fetchMock, assign }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LoginForm', () => {
  it('合言葉が要らなければ、聞かずに入って来た場所へ戻る', async () => {
    const { fetchMock, assign } = stubApi(false)

    render(<LoginForm next="/projects/abc" />)

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/projects/abc')
    })
    const loginCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/login'))
    expect(JSON.parse(loginCall?.[1]?.body as string)).toEqual({ passphrase: '' })
    expect(screen.queryByLabelText('合言葉')).toBeNull()
  })

  it('合言葉が要るなら、聞く', async () => {
    const { assign } = stubApi(true)

    render(<LoginForm next={null} />)

    expect(await screen.findByLabelText('合言葉')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })
})
